import express = require('express');
import cors = require('cors');
import bodyParser = require('body-parser');
import http = require('http');
import socketio = require('socket.io');
import _ = require('lodash');

import axios from 'axios';

import secret from './utils/secret';

const API_HOST =
  process.env.NODE_ENV == 'local' ? 'http://localhost:1380' : 'https://api.castle.games';
const API_HOST_2 = 'https://castle-app-server.herokuapp.com';

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

var httpServer = new http.Server(app);
var io = socketio(httpServer);
var port = process.env.PORT || 3003;

app.get('/', function(req, res) {
  res.status(200).send('woop');
});

app.post('/send-message', (req, res) => {
  try {
    if (req.body.secretKey !== secret.chat.secretKey) {
      throw new Error('incorrect secret key');
    }

    if (!req.body.message) {
      throw new Error('no message');
    }

    let message = req.body.message;
    if (!message.channelId) {
      throw new Error('no channel id');
    }

    if (message.channelId.startsWith('dm-')) {
      let usersIds = message.channelId.split('-')[1].split(',');
      for (let i = 0; i < usersIds.length; i++) {
        io.to(`user-id:${usersIds[i]}`).emit('message', JSON.stringify(req.body.message));
      }
    } else {
      io.to(`channel-id:${message.channelId}`).emit('message', JSON.stringify(req.body.message));
    }

    res.status(200).send('success');
  } catch (e) {
    console.log(e);
    res.status(401).send('failure ' + e.toString());
  }
});

app.post('/get-presence', (req, res) => {
  try {
    if (req.body.secretKey !== secret.chat.secretKey) {
      throw new Error('incorrect secret key');
    }

    if (!req.body.userId) {
      throw new Error('no user id');
    }

    let isOnline =
      _.includes(_.values(connections), `${req.body.userId}`) ||
      _.includes(_.values(connections), parseInt(req.body.userId));

    res.setHeader('content-type', 'application/json');
    res.status(200).send({
      status: isOnline ? 'online' : 'offline',
    });
  } catch (e) {
    console.log(e);
    res.status(401).send('failure ' + e.toString());
  }
});

// deprecated
app.post('/send-channel-message', (req, res) => {
  try {
    if (req.body.secretKey !== secret.chat.secretKey) {
      throw new Error('incorrect secret key');
    }

    if (!req.body.message) {
      throw new Error('no message');
    }

    let message = req.body.message;
    if (!message.channelId) {
      throw new Error('no channel id');
    }

    io.to(`channel-id:${message.channelId}`).emit('message', JSON.stringify(req.body.message));

    res.status(200).send('success');
  } catch (e) {
    console.log(e);
    res.status(401).send('failure ' + e.toString());
  }
});

// deprecated
app.post('/send-user-message', (req, res) => {
  try {
    if (req.body.secretKey !== secret.chat.secretKey) {
      throw new Error('incorrect secret key');
    }

    if (!req.body.message) {
      throw new Error('no message');
    }

    let message = req.body.message;
    if (!message.toUserId) {
      throw new Error('no to user id');
    }

    io.to(`user-id:${message.fromUserId}`).emit('message', JSON.stringify(req.body.message));
    io.to(`user-id:${message.toUserId}`).emit('message', JSON.stringify(req.body.message));

    res.status(200).send('success');
  } catch (e) {
    res.status(401).send('failure ' + e.toString());
  }
});

async function userIdForToken(token) {
  // check both servers until migration is complete
  try {
    let response = await axios.get(API_HOST + `/api/chat/get-user?token=${token}`);
    if (response.status == 200 && response.data && response.data.user_id) {
      return `${response.data.user_id}`;
    }
  } catch (e) {}

  try {
    let response = await axios.get(API_HOST_2 + `/api/chat/get-user?token=${token}`);
    if (response.status == 200 && response.data && response.data.user_id) {
      return `${response.data.user_id}`;
    }
  } catch (e) {}

  return null;
}

let connections = {};
let channels = {};
let socketToChannels = {};

function getOnlineUsers() {
  let userIdsSet = {};
  let connectionIds = _.keys(connections);
  for (let i = 0; i < connectionIds.length; i++) {
    userIdsSet[connections[connectionIds[i]]] = true;
  }

  return {
    userIds: _.keys(userIdsSet),
    connectionIds,
  };
}

function onlineCountForChannel(channel) {
  let connectionsForChannel = channels[channel];

  let userIdsSet = {};
  let connectionIds = _.keys(connectionsForChannel);
  for (let i = 0; i < connectionIds.length; i++) {
    userIdsSet[connectionsForChannel[connectionIds[i]]] = true;
  }

  return _.keys(userIdsSet).length;
}

function channelsForSocketId(socketId) {
  return socketToChannels[socketId] ? _.keys(socketToChannels[socketId]) : [];
}

function sendPresenceEvent() {
  let onlineUsersResult = getOnlineUsers();
  let onlineUserIds = onlineUsersResult.userIds;
  let onlineConnectionIds = onlineUsersResult.connectionIds;

  let channelCountCache = {};

  for (let i = 0; i < onlineConnectionIds.length; i++) {
    let socketId = onlineConnectionIds[i];
    let channelsForThisSocketId = channelsForSocketId(socketId);
    let channelOnlineCounts = {};

    for (let j = 0; j < channelsForThisSocketId.length; j++) {
      let channel = channelsForThisSocketId[j];
      if (!channelCountCache[channel]) {
        channelCountCache[channel] = onlineCountForChannel(channel);
      }

      channelOnlineCounts[channel] = channelCountCache[channel];
    }

    io.to(`${socketId}`).emit('presence', {
      type: 'full-update',
      user_ids: onlineUserIds,
      channel_online_counts: channelOnlineCounts,
    });
  }
}

function joinChannel(socket, userId, channel) {
  socket.join(`channel-id:${channel}`);

  if (!channels[channel]) {
    channels[channel] = {};
  }

  if (!socketToChannels[socket.id]) {
    socketToChannels[socket.id] = {};
  }

  channels[channel][socket.id] = userId;
  socketToChannels[socket.id][channel] = true;
}

function leaveChannel(socket, channel, notifySocket = true) {
  if (notifySocket) {
    socket.leave(`channel-id:${channel}`);
  }

  if (channels[channel] && channels[channel][socket.id]) {
    delete channels[channel][socket.id];
  }

  if (socketToChannels[socket.id] && socketToChannels[socket.id][channel]) {
    delete socketToChannels[socket.id][channel];
  }
}

io.on('connection', async (socket) => {
  let query = socket.handshake.query;

  let userId = await userIdForToken(query.token);

  if (!userId) {
    io.to(socket.id).emit('connection error');
    console.log('auth error');
    return;
  }

  // For dms
  socket.join(`user-id:${userId}`);

  let initialChannels = [];
  try {
    initialChannels = JSON.parse(query.channels);
  } catch (e) {}

  initialChannels.forEach((channel) => {
    joinChannel(socket, userId, channel);
  });

  connections[socket.id] = userId;
  sendPresenceEvent();

  socket.on('disconnect', () => {
    let subscribedChannels = channelsForSocketId(socket.id);
    for (let i = 0; i < subscribedChannels.length; i++) {
      leaveChannel(socket, subscribedChannels[i], false);
    }

    delete connections[socket.id];

    sendPresenceEvent();
  });

  socket.on('join-channels', function(msg) {
    try {
      msg.channels.forEach((channel) => {
        joinChannel(socket, userId, channel);
      });

      sendPresenceEvent();
    } catch (e) {
      console.log(`error joining channels: ${e.toString()}`);
    }
  });

  socket.on('leave-channels', function(msg) {
    try {
      msg.channels.forEach((channel) => {
        leaveChannel(socket, channel);
      });

      sendPresenceEvent();
    } catch (e) {
      console.log(`error leaving channels: ${e.toString()}`);
    }
  });
});

httpServer.listen(port, function() {
  console.log('listening on *:' + port);
});

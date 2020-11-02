import React from 'react';
import { ContextProviderHook, ContextConnector, renderActionObject } from './appcontext.js';
import Websocket from 'react-websocket';

var NetAppVars = {
  socketFlag: false,
  state: 'disconnected', // possible values of state: disconnected, connected, connecting
  url: 'wss://',
  socket: null, // instance of web socket component object
  onMessageArrive: null, // function (message, socketID)
  onNetworkConnection: null, // function (isConnected, url, socketID)
  extSockets: {} /* 
    extension sockets, named by socket ID, where each sockets has the following attributes:
    - socketFlag
    - state
    - url
    - socket
  */
}

function handleCreateAndConnect(vars, url, socketID) {
  return (
    socketID ? {
      ...vars,
      extSockets: {
        ...vars.extSockets,
        [socketID]: {
            url,
            socketFlag: true,
            state: 'connecting',
            socket: null
        }
      }
    } :
    {
      ...vars, 
      url, 
      socketFlag: true, 
      state: 'connecting'
    }
  )
}

function handleDisconnect(vars, socketID) {
  return (
    socketID ? {
      ...vars, 
      extSockets: {
        ...vars.extSockets, 
        [socketID]: {
          ...(vars.extSockets[socketID]), 
          socketFlag: false, 
          state: 'disconnected'
        }
      }
    } : 
    {
      ...vars, 
      socketFlag: false, 
      state: 'disconnected'
    }
  )
}

function handleMessageArriveEvt(vars, message, socketID) {
  if (vars.onMessageArrive)
    vars.onMessageArrive(message, socketID);
}

function handleConnectionEvent(vars, isConnected, wsObject, socketID) {

  if (vars.onNetworkConnection) 
    vars.onNetworkConnection(isConnected, vars.url, socketID);

  return (
    socketID ?
      {
        ...vars,
        extSockets: {
          ...vars.extSockets,
          [socketID]: {
            ...(vars.extSockets[socketID]),
            state: isConnected ? 'connected' : 'disconnected',
            socket: wsObject,
            socketFlag: isConnected
          }
        }
      } :   
      {
        ...vars, 
        state: isConnected ? 'connected' : 'disconnected', 
        socket: wsObject,
        socketFlag: isConnected
      }
  )
}

function handleGetState(vars, outs, socketID) {

  if (typeof(outs) != 'object' || Array.isArray(outs))
    return

  var dataSrc = (!socketID) ? vars : (socketID in vars.extSockets ? vars.extSockets[socketID] : {})
  outs.state = dataSrc.state || 'disconnected' // set default to 'disconnected'
  outs.url = dataSrc.url || ''
  outs.socket = dataSrc.socket || null
}

var NetAppActions = {
  getState: (vars, {outVars, socketID}) => handleGetState(vars, outVars, socketID),
  createAndConnect: (vars, {url, socketID}) => handleCreateAndConnect(vars, url, socketID),
  disconnect: (vars, {socketID}) => handleDisconnect(vars, socketID),
  connectionEvt: (vars, {isConnected, wsObject, socketID}) => (handleConnectionEvent(vars, isConnected, wsObject, socketID)),
  messageArriveEvt: (vars, {message, socketID}) => handleMessageArriveEvt(vars, message, socketID),
  setEventHandlers: (vars, {onMessageHandler, onConnectionState}) => (
    {...vars, onMessageArrive: onMessageHandler, onNetworkConnection: onConnectionState}
  ),
}

const NetAppContext = React.createContext({});

const NetAppProvider = ContextProviderHook(NetAppContext, NetAppActions, NetAppVars)

// expected props:
// in:
// - socketFlag
// - url
// - socketID (optional)
// - onMessageArrive: (message, socketID) => {}
// event:
// - setConnected(connected: true/false, socketID)

class WSConnection_Base extends React.Component {
  constructor (props) {
    super(props);
  }

  onOpen = (e) => {
    var {disp} = this.props
    disp({type: 'connectionEvt', isConnected: true, wsObject: this.refs.wsObject, socketID: this.props.socketID});
  }

  onClose = (e) => {
    var {disp} = this.props
    disp({type: 'connectionEvt', isConnected: false, wsObject: null, socketID: this.props.socketID});
  }

  onMessage = (message) => {
    // console.log('Data received from websocket: ', message);
    // messageArriveEvt does not state change, for optimization, we call onMessageArrive event property directly (no need to dispatch)
    // this.props.messageArriveEvt(message, this.props.socketID);
    if (this.props.onMessageArrive)
      this.props.onMessageArrive(message, this.props.socketID);
  }

  render() {
    console.log(`WSConnection component. SocketID [${this.props.socketID}]: `, (this.props.socketFlag ? 'Flag = TRUE' : 'Flag = FALSE'));
    return (
      this.props.socketFlag ?
        (
          <Websocket 
            ref="wsObject"
            url={this.props.url}
            reconnect={false}
            onMessage={this.onMessage}
            onOpen={this.onOpen}
            onClose={this.onClose}
          />
        ) 
        : 
        <></>
    )
  }
}

const WSConnection = ContextConnector(NetAppContext, (vars, props) => ({
    socketID: props.socketID,
    socketFlag: (!props.socketID) ? vars.socketFlag : 
      (props.socketID in vars.extSockets && vars.extSockets[props.socketID].socketFlag),
    url: (!props.socketID) ? vars.url : (
      props.socketID in vars.extSockets ? vars.extSockets[props.socketID].url : ''
    ), 
    onMessageArrive: vars.onMessageArrive, // change from previous version by directly pass the event handler value
  }),
  (disp) => ({
    'connectionEvt': (isConnected, wsObject, socketID) => disp({type: 'connectionEvt', isConnected, wsObject, socketID})
  })
)(WSConnection_Base);

class WSConnectionAction extends React.PureComponent { // existing ...Action style helper object

  render () {
    return renderActionObject(NetAppContext, this, 
      (state) => {
        this.connectionState = this.props.socketID ? state.extSockets[socketID].state : state.state
        this.wsObject = this.props.socketID ? state.extSockets[socketID].socket : state.socket
      }
    )
  }

  getState (socketID) {
    var outs = {}
    this.disp({type: 'getState', outVars: outs, socketID: this.props.socketID || socketID})
    return outs
  }

  createAndConnect ({url, socketID}) {
    this.disp({type: 'createAndConnect', url, socketID: this.props.socketID || socketID})
  }

  disconnect (socketID) {
    this.disp({type: 'disconnect', socketID: this.props.socketID || socketID})
  }

  send ({text}) {
    // console.log(`Message sent from socketID[${socketID}]: `, text);
    if (this.wsObject && this.connectionState == 'connected')
      this.wsObject.sendMessage(text)
  }

  setEventHandlers ({onMessageHandler, onConnectionState}) {
    this.disp({type: 'setEventHandlers', onMessageHandler, onConnectionState})
  }
}

export { NetAppProvider, NetAppContext, WSConnection, WSConnectionAction };

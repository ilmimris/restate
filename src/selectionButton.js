import React from 'react';
import { ContextConnector } from './appcontext';
import { AppFrameContext } from './appframe_minimal';

const FrameSelButtons_Base = (props) => {
  // expected in props:
  // instances: array of pageInstance object
  // activeInstance: current pageInstance object
  // activateFrame: (instanceName) => {} hook to activate selected frame ID
  // linkTitles: object, mapping instanceName to link title
  return (
    <div style={{display: (props.frameActive ? "block" : "none")}}>
      {
        Object.keys(props.instances).map((k) => {
            var e = props.instances[k];
            return (
              <button
                key={e.instanceName}
                onClick={
                  () => props.disp({type: 'switchPage', treeName: props.useInstanceTree ? props.treeName : undefined, instanceName: e.instanceName}) 
                }
                style={{color: props.activeInstance == e ? 'black' : 'lightgray'}}
              >
              {
                (props.linkTitles ? props.linkTitles[e.instanceName] : '') || e.title
              }
              </button>
            )
          }
        )
      }
    </div>
  )
};

function _connectFrameTree(vars, ownProps) {
  var tree = vars.instanceTreeIndexes[ownProps.treeName]
  if (!tree) {
    return {
      frameActive: false,
      useInstanceTree: true,
      instances: {},
      activeInstance: null,
    }
  } else {
    return {
      frameActive: tree.frameActive,
      useInstanceTree: true,
      instances: tree.pageInstances,
      activeInstance: tree.activeInstance,
    }
  }
}

const FrameSelButtons = ContextConnector(AppFrameContext, 
  (v, props) => (
    v.useInstanceTree ? _connectFrameTree(v, props) : {
        useInstanceTree: false,
        frameActive: v.frameActive,
        instances: v.pageInstances,
        activeInstance: v.activeInstance,
      }
  )
)(FrameSelButtons_Base);

export { FrameSelButtons };
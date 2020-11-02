import React from 'react';
import { ContextConnector } from './appcontext.js';
import { AppFrameContext } from './appframe.js';
import { Menu } from 'semantic-ui-react';

const UISelectionTab_Base = (props) => {
  // expected in props:
  // instances: array of pageInstance object
  // activeInstance: current pageInstance object
  // activateFrame: (instanceName) => {} hook to activate selected frame ID
  // linkTitles: object, mapping instanceName to link title
  return (
    <div style={{display: (props.frameActive ? "block" : "none")}}>
      <Menu>
        {
          Object.keys(props.instances).map((k) => {
              var e = props.instances[k];
              return (
                <Menu.Item
                  key={e.instanceName}
                  name={e.instanceName}
                  active={props.activeInstance === e}
                  onClick={
                    () => props.disp({type: 'switchPage', treeName: props.useInstanceTree ? props.treeName : undefined, instanceName: e.instanceName}) 
                  }
                >
                {
                  (props.linkTitles ? props.linkTitles[e.instanceName] : '') || e.title
                }
                </Menu.Item>
              )
            }
          )
        }
      </Menu>
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

const UISelectionTab = ContextConnector(AppFrameContext, 
  (v, props) => (
    v.useInstanceTree ? _connectFrameTree(v, props) : {
        useInstanceTree: false,
        frameActive: v.frameActive,
        instances: v.pageInstances,
        activeInstance: v.activeInstance,
      }
  )
)(UISelectionTab_Base);

export default UISelectionTab;
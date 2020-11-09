import React from 'react';
import {
    ContextProviderHook,
    ContextConnector,
    renderActionObject,
    yieldEventLoop
} from 'restate/src/appcontext';

var AppState = {
    todos: [
        {
            ID: 0,
            text: "Learn about React",
            isCompleted: false
        },
        {
            ID: 1,
            text: "Meet friend for lunch",
            isCompleted: false
        },
        {
            ID: 2,
            text: "Build really cool todo app",
            isCompleted: false
        },
    ],

}

var AppReducers = {
    getState: (state, { ref }) => { ref.state = { ...state } },
    restoreState: (state, { newState }) => ({ ...state, ...newState }),

    // Todos reducer
    setTodos: (state, { todos }) => ({ ...state, todos }),
}

const AppContext = React.createContext(null)

const ProviderComponent = ContextProviderHook(AppContext, AppReducers, AppState)

class AppProvider extends React.Component {

    constructor(props) {
        super(props);

        this.disp = null;
        this.meth = null;
    }

    render() {
        return (
            <ProviderComponent refDispatch={
                (dispatch, method) => { this.disp = dispatch; this.meth = method }
            } >
                {this.props.children}
            </ProviderComponent>
        );
    };
}

// Get State from ref
const getState = async (disp) => {
    var ref = {}
    await yieldEventLoop()
    disp({ type: 'getState', ref })
    return ref.state;
};


const persistState = (state) => {
    return {
        todos: state.todos,
    }
}

class AppAction extends React.PureComponent {

    // implicit properties (added by renderActionObject)
    // disp : reference to dispatch

    render() {
        return renderActionObject(AppContext, this, (state) => { })
    }

}


// standard "templates" for visual components to connect
const AppInterfaces = {
    todoInfo: ContextConnector(AppContext,
        (state, props) => ({
            todos: state.todos
        }),
        (disp) => ({
            addTodo: async (text) => {
                var state = await getState(disp);

                const lastID = state.todos.reduce((prev, current) => (prev.ID > current.ID) ? prev : current).ID

                const newTodos = [...state.todos, { ID: lastID + 1, text, isCompleted: false }];

                disp({ type: 'setTodos', todos: newTodos })
                persistState(state);
            },

            completeTodo: async (index) => {
                var state = await getState(disp);
                const newTodos = [...state.todos];

                newTodos[index] = { ...newTodos[index], isCompleted: true }

                disp({ type: 'setTodos', todos: newTodos })
                persistState(state);
            },

            removeTodo: async (index) => {
                var state = await getState(disp);

                const newTodos = [...state.todos];
                newTodos.splice(index, 1);

                disp({ type: 'setTodos', todos: newTodos })
                persistState(state);
            },
        })
    ),
}

export { AppProvider, AppContext, AppAction, AppInterfaces };

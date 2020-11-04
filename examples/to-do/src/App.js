import React from 'react'

// application-logic libraries
import { AppProvider } from './App.Data';


// application-UI-pages goes here
import MainApp from "./TodoList";

function App() {
    return (
        <AppProvider>
            <MainApp />
        </AppProvider>
    );
}

export default App

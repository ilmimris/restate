import React from 'react'

// application-logic libraries
import { AppProvider, AppInterfaces } from './App.Data';


// application-UI-pages goes here
import MainApp from "./Main";

function App() {
    return (
        <>
            <AppProvider>
                <MainApp />
            </AppProvider>
        </>
    );
}

export default App

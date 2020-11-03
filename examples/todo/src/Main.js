import React from 'react'

function Main() {
    const [isReady, setIsReady] = React.useState(false);
    //const [appState, _setAppState] = React.useState(AppState.currentState);
    const appStateRef = React.useRef(AppState.currentState);

    //const setAppState = (state) => {
    //    console.log(`before ${appStateRef.current}`);
    //    appStateRef.current = state;
    //    _setAppState(state);
    //}

    const handleAppStateChange = (state) => {
        lastState = appStateRef.current;
        appStateRef.current = state;
        console.log(`handle statechange from ${lastState} to ${state}`)
        timeControl(lastState, state);
        //setAppState(state);
    }
      
    React.useEffect(() => {
        const restoreState = async () => {
            try {
                await loadStore();
            } finally {
                setIsReady(true);
            }
        };
    
        AppState.addEventListener('change', handleAppStateChange);
        if (!isReady) {
            setTimeout(() => restoreState(), 2500);
            //restoreState();
        }
        return (async () => {
            console.log('before unmount');
            AppState.removeEventListener('change', handleAppStateChange);
            await saveStore();
        })
    }, []);

    if (!isReady) {
        //return <ActivityIndicator size="large" />;
        return <SplashScreen />;
    }
  
    return (
        <NavigationContainer>
            <MainNav />
        </NavigationContainer>
    );
}

export default Main

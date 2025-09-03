export const msalConfig = {
  auth: {
    clientId: 'e00c4440-0129-4b66-94dc-02ea645fd13c',
    authority: 'https://login.microsoftonline.com/0b6bfb2a-ae2a-4961-9c6a-bd500f86bfbc',
    redirectUri: window.location.origin,  // Automatically sets to localhost or production URL
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    allowNativeBroker: false, // Disables WAM Broker
    windowHashTimeout: 60000,
    iframeHashTimeout: 6000,
    loadFrameTimeout: 0,
    allowRedirectInIframe: false // Prevent iframe redirects
  }
};

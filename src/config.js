const config = {
    development: {
      // apiUrl: 'http://13.52.86.240:8000',
      apiUrl: 'http://localhost:8000',
    },
    production: {
      // apiUrl: 'http://13.52.86.240:8000',
      apiUrl: 'http://localhost:8000',
    },
  };
  
const getConfig = () => {
    const env = process.env.NODE_ENV || 'development';
    return config[env];
};
  
export default getConfig;
  
// src/config.js
const PROD_BASE = "https://api.geolabs-software.com";
const DEV_BASE = (process.env.REACT_APP_API_URL || "").trim();

const API_URL = process.env.NODE_ENV === "production" ? PROD_BASE : DEV_BASE;
export const API_ENABLED = !!API_URL;

export default API_URL;

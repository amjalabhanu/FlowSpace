import { io } from "socket.io-client";

export const socket = io("http://localhost:5000", {
  withCredentials: true,

  transports: ["websocket", "polling"],

  // Automatic reconnection
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,

  timeout: 20000,
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("Connection failed:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});

socket.io.on("reconnect_attempt", (attempt) => {
  console.log("Reconnection attempt:", attempt);
});

socket.io.on("reconnect", (attempt) => {
  console.log("Reconnected successfully after attempts:", attempt);
});
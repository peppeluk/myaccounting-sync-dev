import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UpdateNotification } from "./components/UpdateNotification";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>
      <App />
      <UpdateNotification />
    </>
  </React.StrictMode>
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { DesktopApp } from "./ui/app";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(<StrictMode><DesktopApp /></StrictMode>);

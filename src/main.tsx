import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { DesktopApp } from "./ui/app";
import { syncSystemTheme } from "./lib/theme";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
syncSystemTheme(document.documentElement, window.matchMedia("(prefers-color-scheme: dark)"));
createRoot(root).render(<StrictMode><DesktopApp /></StrictMode>);

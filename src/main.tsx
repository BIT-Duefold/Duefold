import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Widget from './Widget';
import './styles.css';
import './widget.css';
const isWidget = new URLSearchParams(location.search).get('window') === 'widget';
if (isWidget) document.documentElement.classList.add('widget-window');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{isWidget?<Widget/>:<App/>}</React.StrictMode>);

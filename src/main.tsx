import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './fonts.css';
import './design-system.css';
import './demo-views.css';
import './map.css';
import './workbench.css';
// 草稿自带的设计系统 + Tailwind 工具类（放在最后，让照搬草稿的样式优先）
import './draft.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import { Route, Routes, useLocation } from 'react-router-dom';
import Navigation from './components/navigation';

import dayjs from 'dayjs';

import './index.css';
import './styles/antd.css';
import { Layout, message } from 'antd';
import { useRoutes } from './routes';
import Header from './components/header';
import { useEffect, useState } from 'react';
import { CommonBridge } from '#preload';
import { MESSAGE_CONFIG } from './constants';
import type { BridgeMessage } from '../../shared/types/common';

const { Content, Sider } = Layout;

dayjs.locale('zh-cn');

const App = () => {
  const routes = useRoutes();
  const [isVisible, setIsVisible] = useState(false);
  const [messageApi, contextHolder] = message.useMessage(MESSAGE_CONFIG);

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100); // 延迟显示组件
  }, []);

  const location = useLocation();

  useEffect(() => {
    const handleMessaged = (_: Electron.IpcRendererEvent, msg: BridgeMessage) => {
      messageApi.open({
        type: msg.type,
        content: msg.text,
      });
    };

    CommonBridge?.offMessaged(handleMessaged);

    CommonBridge?.onMessaged(handleMessaged);

    return () => {
      CommonBridge?.offMessaged(handleMessaged);
    };
  }, []);

  return (
    <Layout style={{ height: '100%' }} className={`fade-in ${isVisible ? 'visible' : ''}`}>
      {contextHolder}
      {location.pathname !== '/start' && <Header></Header>}
      <Layout style={{ flex: 1, display: 'flex', flexDirection: 'row' }}>
        {location.pathname !== '/start' && (
          <Sider
            style={{ marginLeft: 10 }}
            width={164}
            className="sider"
          >
            <Navigation></Navigation>
          </Sider>
        )}

        <Content className="content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <Routes>
            {routes.map(route => {
              return (
                <Route
                  key={route.path}
                  path={route.path}
                  Component={route.component}
                />
              );
            })}
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
};
export default App;

import type {MenuProps} from 'antd';
import {Avatar, Button, Dropdown, Layout, Breadcrumb} from 'antd';
import {CloseOutlined, MinusOutlined, BorderOutlined, BlockOutlined, UserOutlined} from '@ant-design/icons';
import {useState} from 'react';
import {customizeToolbarControl} from '#preload';
import type {MenuInfo} from 'rc-menu/lib/interface';
import {theme} from 'antd';
const {useToken} = theme;
import logo from '../../../assets/logo.png';
import {useNavigate, useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';

const {Header: AntdHeader} = Layout;

export default function Header() {
  const {t, i18n} = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const routeNames: Record<string, string> = {
    '/': t('menu_windows'),
    '/proxy': t('menu_proxy'),
    '/sync': t('menu_sync'),
    '/extensions': t('menu_extensions'),
    '/logs': t('menu_logs'),
    '/api': t('menu_api'),
    '/settings': t('header_settings'),
  };

  const pageTitle = routeNames[location.pathname] || t('menu_windows');

  const checkIfMaximized = async () => {
    try {
      const maximized = await customizeToolbarControl.isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      console.error('Failed to check if window is maximized:', error);
    }
  };

  const {token} = useToken();

  const items: MenuProps['items'] = [
    {
      label: t('header_settings'),
      key: 'settings',
    },
    {
      label: t('header_language'),
      key: 'language',
      children: [
        {
          label: 'English',
          key: 'en',
          onClick: () => {
            i18n.changeLanguage('en');
          },
        },
        {
          label: '简体中文',
          key: 'zh-cn',
          onClick: () => {
            i18n.changeLanguage('zh');
          },
        },
      ],
    },
  ];

  const appControl = (action: 'close' | 'minimize' | 'maximize') => {
    customizeToolbarControl[action]();
    checkIfMaximized();
  };

  const dropdownAction = (info: MenuInfo) => {
    switch (info.key) {
      case 'settings':
        navigate('/settings');
        break;
      default:
        break;
    }
  };

  return (
    <AntdHeader className="app-header">
      <div className="header-drag-area draggable">
        <img src={logo} alt="logo" className="header-logo" />
        <Breadcrumb
          className="header-breadcrumb"
          items={[
            { title: t('app_name') },
            { title: pageTitle },
          ]}
        />
      </div>
      <div className="header-actions">
        <Dropdown
          menu={{items, onClick: menuInfo => dropdownAction(menuInfo)}}
          trigger={['click']}
        >
          <Avatar size={28} style={{ backgroundColor: token.colorPrimary, cursor: 'pointer', marginRight: 10 }} icon={<UserOutlined />} />
        </Dropdown>
        <Button
          icon={<MinusOutlined />}
          onClick={() => appControl('minimize')}
          onMouseEnter={() => setHoveredBtn('minimize')}
          onMouseLeave={() => setHoveredBtn(null)}
          className="window-btn"
        />
        <Button
          onClick={() => appControl('maximize')}
          onMouseEnter={() => setHoveredBtn('maximize')}
          onMouseLeave={() => setHoveredBtn(null)}
          icon={isMaximized ? <BlockOutlined /> : <BorderOutlined />}
          className="window-btn"
        />
        <Button
          onClick={() => appControl('close')}
          onMouseEnter={() => setHoveredBtn('close')}
          onMouseLeave={() => setHoveredBtn(null)}
          icon={<CloseOutlined />}
          className="window-btn window-btn-close"
        />
      </div>
    </AntdHeader>
  );
}

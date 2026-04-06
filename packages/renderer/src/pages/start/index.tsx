import axios from 'axios';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Space, Badge, Descriptions, Tag, Typography } from 'antd';

const { Title, Text } = Typography;

export default function Start() {
  const [search] = useSearchParams();

  const [windowInfo, setWindowInfo] = useState({
    id: '',
    name: '',
    group_name: '',
    opened_at: '',
    profile_id: '',
    remark: '',
    tags_name: [],
  });
  const [moreInfo, setMoreInfo] = useState({
    ip: '',
    country: '',
    ll: [],
    userAgent: '',
    language: '',
    timeZone: '',
  });
  const PIN_URL = [
    { name: 'Google', n: 'GG' },
    { name: 'Discord', n: 'DC' },
    { name: 'Twitter', n: 'X' },
  ];
  const [pings, setPings] = useState<{ status: string }[]>([]);
  const [checking, setChecking] = useState(false);

  const checkPing = async () => {
    const windowId = search.get('windowId');
    const serverPort = search.get('serverPort') || 49156;
    setChecking(true);
    try {
      const res = await axios.get(`http://localhost:${serverPort}/ip/ping`, {
        params: { windowId: windowId },
      });
      const { pings } = res.data;
      setPings(pings);
      setChecking(false);
    } catch (error) {
      setChecking(false);
    }
  };

  function getStatus(status: string) {
    if (!status && !checking) return 'default';
    if (checking) return 'processing';
    return status === 'connected' ? 'success' : 'error';
  }

  const fetchInfo = async () => {
    const windowId = search.get('windowId');
    const serverPort = search.get('serverPort') || 49156;
    if (!windowId) return;
    try {
      const res = await axios.get(`http://localhost:${serverPort}/window/info`, {
        params: { windowId: windowId },
      });
      const { windowData, ipInfo } = res.data;
      setWindowInfo(windowData);
      setMoreInfo({
        ...ipInfo,
        userAgent: windowData.ua,
      });
      if (ipInfo?.ip) checkPing();
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    fetchInfo();
  }, [search]);

  useEffect(() => {
    const windowId = search.get('windowId');
    if (windowId) {
      document.title = `(#${windowId}) ${windowInfo.name || '未命名'} ${moreInfo.ip ? '| IP:' + moreInfo.ip : ''} ｜ Chrome Power`;
    }
  }, [moreInfo.ip, windowInfo.name]);

  return (
    <div className="min-h-screen bg-gradient-to-r from-purple-200 via-blue-300 to-pink-200 flex justify-center items-center p-6">
      <Card
        variant="borderless"
        className="shadow-2xl rounded-2xl"
        style={{ width: 480, margin: '80px auto'}}
        title={
          <div className="flex items-center justify-center gap-2">
            <span className="text-lg font-bold text-gray-800">
              {moreInfo.ip || 'Disconnected'}
            </span>
            <span className="text-sm text-gray-500">
              {moreInfo.country && moreInfo.timeZone ? `- ${moreInfo.country} - ${moreInfo.timeZone}` : ''}
            </span>
          </div>
        }
        extra={
          <div className="flex justify-center w-full">
            <Space size={16}>
              {PIN_URL.map((item, index) => (
                <Badge
                  key={index}
                  status={getStatus(pings[index]?.status)}
                  text={item.n}
                  className={checking ? 'animate-pulse' : ''}
                />
              ))}
            </Space>
          </div>
        }
      >
        {/* 窗口信息 */}
        <div className="mb-6">
          <Title level={5} className="mb-3 text-gray-700">窗口信息</Title>
          <Descriptions column={1} size="small" colon={false} className="[&_.ant-descriptions-item-label]:text-gray-500 [&_.ant-descriptions-item-label]:w-20 [&_.ant-descriptions-item-content]:text-gray-800">
            <Descriptions.Item label="ID">{windowInfo.id || '-'}</Descriptions.Item>
            <Descriptions.Item label="名称">{windowInfo.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="分组">{windowInfo.group_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="启动时间">
              {(() => {
                if (!windowInfo.opened_at) return '-';
                const d = new Date(windowInfo.opened_at);
                return isNaN(d.getTime()) ? windowInfo.opened_at : d.toLocaleString();
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="缓存目录">{windowInfo.profile_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="备注">{windowInfo.remark || '-'}</Descriptions.Item>
            <Descriptions.Item label="标签">
              <Space wrap>
                {windowInfo.tags_name?.length > 0 ? (
                  windowInfo.tags_name.map((name, i) => <Tag key={i} color="cyan">{name}</Tag>)
                ) : (
                  '-'
                )}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* 更多信息 */}
        <div>
          <Title level={5} className="mb-3 text-gray-700">更多信息</Title>
          <Descriptions column={1} size="small" colon={false} className="[&_.ant-descriptions-item-label]:text-gray-500 [&_.ant-descriptions-item-label]:w-20 [&_.ant-descriptions-item-content]:text-gray-800">
            <Descriptions.Item label="地理坐标">
              {moreInfo?.ll?.length ? `[${moreInfo.ll[0]}, ${moreInfo.ll[1]}]` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="时区">{moreInfo.timeZone || '-'}</Descriptions.Item>
          </Descriptions>
        </div>
      </Card>
    </div>
  );
}
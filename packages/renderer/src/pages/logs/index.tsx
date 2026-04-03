import {Tabs, Flex} from 'antd';
import {CommonBridge} from '#preload';
import {useEffect} from 'react';
import React from 'react';

interface logsDataOptions {
  name: string;
  content: Array<{
    level: string;
    message: string;
  }>;
}

const Logs = () => {
  const items = [
    {
      key: 'Main',
      label: 'Main',
    },
    {
      key: 'Window',
      label: 'Windows',
    },
    {
      key: 'Proxy',
      label: 'Proxy',
    },
    {
      key: 'Service',
      label: 'Service',
    },
  ];
  const [logsData, setLogsData] = React.useState<logsDataOptions[]>([]);

  const fetchLogs = async (logModule: 'Main' | 'Windows' | 'Proxy' | 'Api') => {
    const logs = await CommonBridge.getLogs(logModule);
    setLogsData(logs.reverse());
  };

  useEffect(() => {
    fetchLogs('Main');
  }, []);

  return (
    <div className="page-container">
      <div className="page-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Tabs onChange={(key: string) => fetchLogs(key as 'Main' | 'Windows' | 'Proxy' | 'Api')} size="small" items={items} />
        <aside className="log-container log-terminal" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <Flex justify="space-between" align="center" className="log-header">
            <Flex gap={8}>
              <div className="log-dot log-dot-red" />
              <div className="log-dot log-dot-yellow" />
              <div className="log-dot log-dot-green" />
            </Flex>
          </Flex>
          <div>
            {logsData.map((logs, logsIndex) => {
              const reversedLogs = [...logs.content].reverse();
              return reversedLogs.map((log, index) => {
                const colorClass = log.level === 'error' ? 'log-level-error' : log.level === 'warn' ? 'log-level-warn' : 'log-level-info';
                return <p key={`${logs.name}-${logsIndex}-${index}`} className={`log-line ${colorClass}`}>{log.message}</p>;
              });
            })}
          </div>
        </aside>
      </div>
    </div>
  );
};
export default Logs;

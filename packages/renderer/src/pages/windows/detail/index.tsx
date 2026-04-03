import type {TabsProps} from 'antd';
import {Card, Tabs, Flex} from 'antd';
import WindowEditForm from '../components/edit-form';
import WindowImportForm from '../components/import-form';
import {useCallback, useEffect, useState} from 'react';
import type {DB, SafeAny} from '../../../../../shared/types/db';
import {useSearchParams} from 'react-router-dom';
import {WindowBridge} from '#preload';
import FingerprintInfo from '../components/fingerprint-info';
import WindowDetailFooter from '../components/edit-footer';
import {useTranslation} from 'react-i18next';

const WindowDetailTabs = ({
  formValue,
  onChange,
  formValueChangeCallback,
}: {
  formValue: DB.Window;
  fingerprints?: SafeAny;
  onChange: (key: string) => void;
  formValueChangeCallback: (changed: DB.Window, data: DB.Window) => void;
}) => {
  const {t} = useTranslation();
  const DEFAULT_ACTIVE_KEY = '0';
  const items: TabsProps['items'] = [
    {
      key: 'windowForm',
      label: t('window_detail_create'),
      forceRender: true,
      children: (
        <Flex gap={48} style={{ width: '100%' }}>
          {WindowEditForm({ loading: false, formValue: formValue, formChangeCallback: formValueChangeCallback })}
        </Flex>
      ),
    },
    {
      key: 'import',
      label: t('window_detail_import'),
      children: WindowImportForm(),
    },
  ];

  return (
    <Tabs
      size="small"
      defaultActiveKey={DEFAULT_ACTIVE_KEY}
      items={items}
      onChange={onChange}
    />
  );
};

const WindowDetail = () => {
  // const [formValue, setFormValue] = useState<DB.Window>({});
  const [formValue, setFormValue] = useState<DB.Window>(new Object());
  const [currentTab, setCurrentTab] = useState('windowForm');
  const [searchParams] = useSearchParams();
  const [fingerprints, setFingerprints] = useState<SafeAny>(new Object());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initFormValue();
  }, [searchParams]);

  const fetchFingerprints = async (windowId?: number) => {
    try {
      // eslint-disable-next-line no-unsafe-optional-chaining
      const data = await WindowBridge?.getFingerprint(windowId);
      setFingerprints(data);
    } catch (error) {
      setFingerprints(new Object());
      console.log(error);
    }
  };

  const initFormValue = async () => {
    const id = searchParams.get('id');
    setLoading(true);
    if (id) {
      const window = await WindowBridge?.getById(Number(id));
      if (window.tags) {
        if (typeof window.tags === 'string') {
          window.tags = window.tags.split(',').map((item: string) => Number(item));
        } else if (typeof window.tags === 'number') {
          window.tags = [window.tags];
        }
      } else {
        window.tags = [];
      }
      setFormValue(window || new Object());
      fetchFingerprints(Number(id));
    } else {
      setFormValue(new Object());
      fetchFingerprints();
    }
    setLoading(false);
  };

  const onTabChange = useCallback((tab: string) => {
    setCurrentTab(tab);
  }, []);

  const formValueChangeCallback = (changed: DB.Window, _: DB.Window) => {
    const newFormValue = {
      ...formValue,
      ...changed,
    };
    setFormValue(newFormValue);
    // setFormValue(data);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Card style={{ flex: 1, overflow: 'auto' }}>
        {searchParams.get('id') ? (
          <Flex gap={48} align="flex-start" style={{ padding: 16 }}>
            <WindowEditForm loading={loading} formValue={formValue} formChangeCallback={formValueChangeCallback} />
            <FingerprintInfo fingerprints={fingerprints} />
          </Flex>
        ) : (
          <WindowDetailTabs
            formValue={formValue}
            onChange={onTabChange}
            fingerprints={fingerprints}
            formValueChangeCallback={formValueChangeCallback}
          />
        )}
      </Card>
      <WindowDetailFooter loading={loading} currentTab={currentTab} formValue={formValue} fingerprints={fingerprints} />
    </div>
  );
};

export default WindowDetail;

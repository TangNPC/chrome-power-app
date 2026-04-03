import {Button, Card, Form, Input, Space, Flex} from 'antd';
import {CommonBridge} from '#preload';
import {useEffect, useState} from 'react';
import type {SettingOptions} from '../../../../shared/types/common';
import {useTranslation} from 'react-i18next';

type FieldType = {
  profileCachePath: string;
  useLocalChrome: boolean;
  localChromePath: string;
  chromiumBinPath: string;
  automationConnect: boolean;
};

const Settings = () => {
  const [formValue, setFormValue] = useState<SettingOptions>({
    profileCachePath: '',
    useLocalChrome: true,
    localChromePath: '',
    chromiumBinPath: '',
    automationConnect: false,
  });
  const [form] = Form.useForm();
  const {t} = useTranslation();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const settings = await CommonBridge.getSettings();
    setFormValue(settings);
    form.setFieldsValue(settings);
  };

  const handleSave = async (values: SettingOptions) => {
    await CommonBridge.saveSettings(values);
  };

  const handleChoosePath = async (
    field: 'profileCachePath' | 'localChromePath' | 'chromiumBinPath',
    type: 'openFile' | 'openDirectory',
  ) => {
    const path = await CommonBridge.choosePath(type);
    if (!formValue[field] || (path && formValue[field] !== path)) {
      handleFormValueChange({
        ...formValue,
        [field]: path,
      });
    }
  };

  const handleFormValueChange = (changed: SettingOptions) => {
    const newFormValue = {
      ...formValue,
      ...changed,
    };
    setFormValue(newFormValue);
    handleSave(newFormValue);
  };

  // type FieldType = SettingOptions;

  return (
    <div className="page-container">
      <Card variant="borderless" className="page-card" style={{ padding: 24 }}>
        <Form name="settingsForm" labelCol={{span: 5}} size="large" form={form} initialValues={formValue} onValuesChange={handleFormValueChange} style={{ maxWidth: 600 }}>
          <Form.Item<FieldType> label={t('settings_cache_path')} name="profileCachePath">
            <Space.Compact style={{width: '100%'}}>
              <Input readOnly disabled value={formValue.profileCachePath} />
              <Button type="default" onClick={() => handleChoosePath('profileCachePath', 'openDirectory')}>{t('settings_choose_cache_path')}</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item<FieldType> label={t('settings_chrome_path')} name="localChromePath" style={{visibility: formValue.useLocalChrome ? 'visible' : 'hidden', minHeight: formValue.useLocalChrome ? 'auto' : 0, marginBottom: formValue.useLocalChrome ? 24 : 0}}>
            <Space.Compact style={{width: '100%', opacity: formValue.useLocalChrome ? 1 : 0}}>
              <Input readOnly disabled value={formValue.localChromePath} />
              <Button type="default" onClick={() => handleChoosePath('localChromePath', 'openFile')}>{t('settings_choose_cache_path')}</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item<FieldType> label={t('setting_chromium_path')} name="chromiumBinPath" style={{visibility: formValue.useLocalChrome ? 'hidden' : 'visible', minHeight: formValue.useLocalChrome ? 0 : 'auto', marginBottom: formValue.useLocalChrome ? 0 : 24}}>
            <Space.Compact style={{width: '100%', opacity: formValue.useLocalChrome ? 0 : 1}}>
              <Input readOnly disabled value={formValue.chromiumBinPath} />
              <Button type="default" onClick={() => handleChoosePath('chromiumBinPath', 'openFile')}>{t('settings_choose_cache_path')}</Button>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};
export default Settings;

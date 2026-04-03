import {
  Button,
  Card,
  Col,
  Row,
  Upload,
  Modal,
  Space,
  message,
  Typography,
  Spin,
  Form,
  Input,
  Checkbox,
  Divider,
  Dropdown,
  Select,
  Flex,
} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  PlusOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MoreOutlined,
  DeleteOutlined,
  SyncOutlined,
  ExclamationCircleFilled,
  SearchOutlined,
} from '@ant-design/icons';
import type {CheckboxProps, MenuProps, UploadProps} from 'antd';
import {ExtensionBridge, WindowBridge, GroupBridge} from '#preload';
import type {DB} from '../../../../shared/types/db';
import type {UploadFile} from 'antd/es/upload/interface';
import {debounce} from 'lodash';
import {containsKeyword} from '/@/utils/str';
import type {SearchProps} from 'antd/es/input';

const {Text} = Typography;
const {Meta} = Card;

const CheckboxGroup = Checkbox.Group;

const Extensions = () => {
  const {t} = useTranslation();
  const [loading, setLoading] = useState(false);
  const [extensions, setExtensions] = useState<DB.Extension[]>([]);
  const [messageApi, contextHolder] = message.useMessage({
    duration: 2,
    top: 120,
    getContainer: () => document.body,
  });
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [applyModalVisible, setApplyModalVisible] = useState(false);
  const [selectedExtension, setSelectedExtension] = useState<DB.Extension>();
  const [windows, setWindows] = useState<DB.Window[]>([]);
  const [selectedWindows, setSelectedWindows] = useState<number[]>([]);
  const [form] = Form.useForm();
  const currentIds = windows.map(w => w.id!);
  const currentSelectedCount = selectedWindows.filter(id => currentIds.includes(id)).length;
  const indeterminate = currentSelectedCount > 0 && currentSelectedCount < windows.length;
  const checkAll = windows.length > 0 && currentSelectedCount === windows.length;
  const [searchValue, setSearchValue] = useState('');
  const [groupOptions, setGroupOptions] = useState<DB.Group[]>([{id: -1, name: 'All'}]);
  const [windowDataCopy, setWindowDataCopy] = useState<DB.Window[]>([]);

  const moreActionItems: MenuProps['items'] = [
    {
      key: 'update',
      label: t('extension_update'),
      icon: <SyncOutlined />,
    },
    {
      type: 'divider',
    },
    {
      key: 'delete',
      danger: true,
      label: t('extension_delete'),
      icon: <DeleteOutlined />,
    },
  ];

  const onChange = (list: number[]) => {
    const currentIds = windows.map(w => w.id!);
    // 保留不在当前视图的选中项
    setSelectedWindows(prev => [...prev.filter(id => !currentIds.includes(id)), ...list]);
  };

  const onCheckAllChange: CheckboxProps['onChange'] = e => {
    const currentIds = windows.map(w => w.id!);
    if (e.target.checked) {
      // 当全选时，保留不在当前视图的选中项，并添加当前视图的所有项
      setSelectedWindows(prev => [...prev.filter(id => !currentIds.includes(id)), ...currentIds]);
    } else {
      // 当取消全选时，只移除当前视图的选中项
      setSelectedWindows(prev => prev.filter(id => !currentIds.includes(id)));
    }
  };

  const handleExtensionAction = async (key: string, extension: DB.Extension) => {
    switch (key) {
      case 'update':
        setUploadVisible(true);
        setSelectedExtension(extension);
        form.setFieldsValue({
          id: extension.id,
          path: extension.path,
          version: extension.version,
          name: extension.name,
          description: extension.description,
        });

        break;
      case 'delete':
        Modal.confirm({
          title: t('extension_delete_confirm_title'),
          icon: <ExclamationCircleFilled />,
          content: t('extension_delete_confirm_content'),
          okText: t('footer_ok'),
          cancelText: t('footer_cancel'),
          onOk: async () => {
            try {
              const result = await ExtensionBridge.deleteExtension(extension.id!);
              if (result instanceof Object && !result?.success) {
                messageApi.error(result.message);
              } else {
                await fetchExtensions();
                messageApi.success(t('extension_delete_success'));
              }
            } catch (error) {
              messageApi.error(t('extension_delete_failed'));
            }
          },
        });
        break;
    }
  };

  const fetchExtensions = async () => {
    setLoading(true);
    try {
      const data = await ExtensionBridge.getAll();
      setExtensions(data);
    } catch (error) {
      messageApi.error('获取扩展列表失败');
    }
    setLoading(false);
  };

  const fetchExtensionWindows = async (extensionId: number) => {
    const data = await ExtensionBridge.getExtensionWindows(extensionId);
    setSelectedWindows(data.map((w: DB.WindowExtension) => w.window_id));
  };

  const handleApplyToWindow = async () => {
    if (!selectedExtension || !selectedWindows) return;

    try {
      await ExtensionBridge.syncWindowExtensions(selectedExtension.id!, selectedWindows);
      messageApi.success('应用成功');
    } catch (error) {
      messageApi.error('应用失败');
    }
    setApplyModalVisible(false);
  };

  const handleUploadExtension = async (extension: DB.Extension) => {
    if (!extension.path) {
      messageApi.error('请上传扩展安装包');
      return;
    }
    if (selectedExtension) {
      try {
        await ExtensionBridge.updateExtension(selectedExtension.id!, extension);
        messageApi.success('更新成功');
        handleModalClose();
        fetchExtensions();
      } catch (error) {
        messageApi.error('更新失败');
      }
    } else {
      try {
        await ExtensionBridge.createExtension(extension);
        messageApi.success('上传成功');
        handleModalClose();
        fetchExtensions();
      } catch (error) {
        messageApi.error('上传失败');
      }
    }
  };

  const fetchWindows = async () => {
    const data = await WindowBridge.getAll();
    setWindows(data);
    setWindowDataCopy(data);
  };

  const fetchGroupData = async () => {
    const data = await GroupBridge?.getAll();
    data.splice(0, 0, {id: -1, name: 'All'});
    setGroupOptions(data);
  };

  const handleGroupChange = (value: number) => {
    if (value > -1) {
      const filteredWindows = [...windowDataCopy].filter(f => f.group_id === value);
      setWindows(filteredWindows);
      // 保持已选中但不在当前视图的窗口ID
      setSelectedWindows(prev => {
        const filteredIds = filteredWindows.map(w => w.id!);
        return [
          ...prev.filter(
            id =>
              !windowDataCopy.find(w => w.id === id)?.group_id ||
              windowDataCopy.find(w => w.id === id)?.group_id !== value,
          ),
          ...prev.filter(id => filteredIds.includes(id)),
        ];
      });
    } else {
      setWindows(windowDataCopy);
    }
  };

  const onSearch: SearchProps['onSearch'] = (value: string) => {
    if (value) {
      const keyword = value.toLowerCase();
      const filteredWindows = [...windowDataCopy].filter(
        f =>
          containsKeyword(f.group_name, keyword) ||
          containsKeyword(f.name, keyword) ||
          containsKeyword(f.id, keyword),
      );
      setWindows(filteredWindows);
      // 保持已选中但不在当前视图的窗口ID
      setSelectedWindows(prev => {
        const filteredIds = filteredWindows.map(w => w.id!);
        return [
          ...prev.filter(id => !filteredIds.includes(id)),
          ...prev.filter(id => filteredIds.includes(id)),
        ];
      });
    } else {
      setWindows(windowDataCopy);
    }
  };

  const debounceSearch = debounce(value => {
    onSearch(value);
  }, 500);

  const handleSearchValueChange = (value: string) => {
    setSearchValue(value.trim());
    debounceSearch(value.trim());
  };

  useEffect(() => {
    fetchWindows();
    fetchExtensions();
    fetchGroupData();
  }, []);

  const UploadForm = () => {
    const [fileList, setFileList] = useState<UploadFile[]>([]);

    const uploadProps: UploadProps = {
      name: 'extension',
      showUploadList: false,
      fileList,
      onChange: ({fileList: newFileList}) => {
        setFileList(newFileList);
      },
      accept: '.zip',
      customRequest: async ({file, onSuccess, onError}) => {
        try {
          setUploading(true);
          const result = await ExtensionBridge.uploadPackage(
            (file as File).path,
            selectedExtension?.id,
          );
          if (result.success) {
            form.setFieldsValue({
              id: result.extensionId,
              path: result.path,
              version: result.version,
              name: result.name,
            });
            onSuccess?.(file);
          } else {
            onError?.(new Error(result.error));
            messageApi.error('上传失败: ' + result.error);
          }
        } catch (error) {
          messageApi.error('上传失败');
        }
        setUploading(false);
      },
    };

    // const iconUploadProps: UploadProps = {
    //     name: 'icon',
    //     showUploadList: false,
    //     accept: '.jpg,.jpeg,.png',
    //     beforeUpload: (file) => {
    //         const isImage = /\.(jpg|jpeg|png)$/.test(file.name);
    //         if (!isImage) {
    //             message.error(t('extension_icon_format_error'));
    //             return false;
    //         }
    //         if (file.size > 1024 * 1024) {
    //             message.error(t('extension_icon_size_error'));
    //             return false;
    //         }

    //         const reader = new FileReader();
    //         reader.onload = () => {
    //             setIconUrl(reader.result as string);
    //         };
    //         reader.readAsDataURL(file as Blob);
    //         return true;
    //     }
    // };

    return (
      <Form
        form={form}
        layout="vertical"
        size="large"
        onFinish={handleUploadExtension}
        initialValues={{
          id: '',
          path: '',
          name: '',
          version: '',
          description: '',
        }}
        requiredMark="optional"
      >
        <Form.Item
          name="id"
          hidden
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="path"
          hidden
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="version"
          hidden
        >
          <Input />
        </Form.Item>

        {/* <Form.Item
                    label={t('extension_icon')}
                    tooltip={t('extension_icon_tooltip')}
                >
                    <Upload {...iconUploadProps}>
                        <div className="w-[120px] h-[120px] border-2 border-dashed border-gray-200 rounded flex items-center justify-center cursor-pointer hover:border-blue-400">
                            {iconUrl ? (
                                <img src={iconUrl} className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center">
                                    <CloudUploadOutlined className="text-2xl" />
                                    <div>{t('extension_icon_upload_placeholder')}</div>
                                </div>
                            )}
                        </div>
                    </Upload>
                </Form.Item> */}

        <Form.Item
          label={t('extension_name')}
          name="name"
          required
          rules={[{required: true, message: t('extension_name_required')}]}
        >
          <Input
            maxLength={20}
            showCount
            placeholder={t('extension_name_placeholder')}
          />
        </Form.Item>

        <Form.Item
          label={t('extension_description')}
          name="description"
          tooltip={t('extension_description_tooltip')}
        >
          <Input.TextArea
            maxLength={200}
            showCount
            placeholder={t('extension_description_placeholder')}
            rows={4}
          />
        </Form.Item>

        {form.getFieldValue('id') && !selectedExtension ? (
          <Flex vertical gap={8}>
            <div>{t('extension_install_package')}</div>
            <Flex align="center" gap={8}>
              <CheckCircleOutlined style={{ color: '#22c55e' }} />
              {fileList.map(file => (
                <span key={file.uid} style={{ color: '#6b7280', fontSize: 14 }}>{file.name}</span>
              ))}
              <span>{t('extension_upload_success')}</span>
              <CloseCircleOutlined style={{ color: '#ef4444', cursor: 'pointer', marginLeft: 8 }} onClick={() => { form.setFieldsValue({id: '', path: ''}); setFileList([]); }} />
            </Flex>
          </Flex>
        ) : (
          <Form.Item label={t('extension_install_package')} required tooltip={t('extension_install_package_tooltip')}>
            <Upload.Dragger {...uploadProps}>
              <CloudUploadOutlined style={{ fontSize: 24 }} />
              <div style={{ marginTop: 8 }}>{t('extension_upload2')}</div>
              <div style={{ color: '#9ca3af', fontSize: 14 }}>{t('extension_zip_format_tip')}</div>
            </Upload.Dragger>
            {uploading && <div style={{ color: '#9ca3af', fontSize: 14, marginTop: 8 }}>{t('extension_uploading')}</div>}
            {selectedExtension && <div style={{ color: '#9ca3af', fontSize: 14, marginTop: 8 }}>{t('extension_current_version')}: {selectedExtension.version}</div>}
          </Form.Item>
        )}

        <Form.Item style={{ marginBottom: 0 }}>
          <Flex justify="flex-end" gap={16}>
            <Button type="text" style={{ width: 80 }} onClick={() => setUploadVisible(false)}>{t('footer_cancel')}</Button>
            <Button type="primary" style={{ width: 80 }} onClick={() => form.submit()}>{t('footer_ok')}</Button>
          </Flex>
        </Form.Item>
      </Form>
    );
  };

  const handleModalClose = () => {
    form.resetFields();
    setUploadVisible(false);
    setSelectedExtension(undefined);
  };

  return (
    <div className="page-container">
      {contextHolder}
      <Flex align="center" className="page-toolbar" style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSelectedExtension(undefined); setUploadVisible(true); }}>
          {t('extension_upload')}
        </Button>
      </Flex>

      <div className="page-card" style={{ overflowY: 'auto' }}>
        <Row gutter={[16, 16]}>
        {loading ? (
          <Spin />
        ) : (
          extensions.map(ext => (
            <Col xs={24} sm={12} md={8} lg={6} xl={6} xxl={4} key={ext.id}>
              <Card hoverable title={ext.name} cover={ext.icon && <img alt={ext.name} src={ext.icon} />} extra={
                <Dropdown menu={{ items: moreActionItems, onClick: ({key}) => handleExtensionAction(key, ext) }} trigger={['hover']} placement="bottomRight">
                  <MoreOutlined style={{ cursor: 'pointer', fontSize: 18 }} />
                </Dropdown>
              } actions={[<Button type="link" onClick={() => { setSelectedExtension(ext); fetchExtensionWindows(ext.id!); setApplyModalVisible(true); }}>{t('extension_apply_to_window')}</Button>]}>
                <Meta description={<Space direction="vertical"><Text type="secondary">ID: {ext.id}</Text><Text type="secondary">{t('extension_version')}: {ext.version}</Text><Text type="secondary">{t('extension_update_time')}: {ext.updated_at}</Text></Space>} />
              </Card>
            </Col>
          ))
        )}
      </Row>
      </div>

      <Modal title={<Typography style={{ fontSize: 20, fontWeight: 'bold' }}>{selectedExtension ? t('extension_update2') : t('extension_upload2')}</Typography>} open={uploadVisible} onCancel={handleModalClose} footer={null} width={640}>
        <UploadForm />
      </Modal>

      <Modal title={<Typography style={{ fontSize: 20, fontWeight: 'bold' }}>{t('extension_apply_to_window')}</Typography>} open={applyModalVisible} onOk={handleApplyToWindow} onCancel={() => setApplyModalVisible(false)}>
        <div style={{ padding: 16 }}>
          <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
            <Checkbox indeterminate={indeterminate} onChange={onCheckAllChange} checked={checkAll} style={{ fontSize: 16, fontWeight: 500 }}>{t('extension_select_all')}</Checkbox>
            <Space size={16}>
              <Select defaultValue={-1} defaultActiveFirstOption style={{width: 120}} fieldNames={{value: 'id', label: 'name'}} onChange={handleGroupChange} options={groupOptions} />
              <Input value={searchValue} style={{ width: 200 }} placeholder={t('search_window')} onChange={e => handleSearchValueChange(e.target.value)} prefix={<SearchOutlined />} />
            </Space>
          </Flex>
          <Divider style={{ margin: '8px 0' }} />
          <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 8 }}>
            <CheckboxGroup value={selectedWindows} onChange={onChange}>
              <Row gutter={[16, 8]}>
                <Col span={24}>
                  {windows.map(w => (
                    <div key={w.id} style={{ padding: 8, borderRadius: 6, transition: 'background 0.2s' }} onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <Checkbox value={w.id}>
                        <Space>
                          <Text type="secondary">#{w.id}</Text>
                          <Text strong>{w.name}</Text>
                          {w.group_name && <Text type="secondary" style={{ padding: '2px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: 4, fontSize: 12 }}>{w.group_name}</Text>}
                        </Space>
                      </Checkbox>
                    </div>
                  ))}
                </Col>
              </Row>
            </CheckboxGroup>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Extensions;

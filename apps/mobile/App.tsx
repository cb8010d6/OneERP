import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, TextInput, Alert, ScrollView, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, Scan, Box, LogOut, CheckCircle2, Settings, X } from 'lucide-react-native';
import { CameraView, useCameraPermissions, CameraType, BarcodeScanningResult } from 'expo-camera';
import axios from 'axios';

export default function App() {
  const [apiUrl, setApiUrl] = useState('http://192.168.1.100:8000/api');
  const [showSettings, setShowSettings] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [companyId, setCompanyId] = useState('');
  
  // 登录表单
  const [email, setEmail] = useState('admin');
  const [password, setPassword] = useState('admin');
  
  // 扫码枪表单
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [statusMsg, setStatusMsg] = useState('');
  
  // 真实摄像头相关
  const [isScanning, setIsScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    checkLocalAuth();
  }, []);

  const checkLocalAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('token');
      const storedCompanyId = await AsyncStorage.getItem('companyId');
      const storedApiUrl = await AsyncStorage.getItem('apiUrl');
      if (storedApiUrl) {
        setApiUrl(storedApiUrl);
      }
      if (storedToken && storedCompanyId) {
        setToken(storedToken);
        setCompanyId(storedCompanyId);
        setIsLoggedIn(true);
      }
    } catch (e) {}
  };

  const handleSaveSettings = async () => {
    if (!apiUrl) return Alert.alert('错误', '请输入服务器地址');
    await AsyncStorage.setItem('apiUrl', apiUrl);
    setShowSettings(false);
    Alert.alert('设置已保存', '服务器地址已更新');
  };

  const handleLogin = async () => {
    try {
      const res = await axios.post(`${apiUrl}/auth/login`, { email, password });
      const { accessToken, companies } = res.data;
      if (companies && companies.length > 0) {
        const defaultCompany = companies[0].id;
        await AsyncStorage.setItem('token', accessToken);
        await AsyncStorage.setItem('companyId', defaultCompany);
        setToken(accessToken);
        setCompanyId(defaultCompany);
        setIsLoggedIn(true);
      } else {
        Alert.alert('登录失败', '未找到绑定的公司信息');
      }
    } catch (error: any) {
      Alert.alert('网络错误', error.message || '请检查服务器地址');
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('companyId');
    setIsLoggedIn(false);
    setToken('');
  };

  const handleScanSimulation = async () => {
    if (!sku) return Alert.alert('错误', '请输入或扫描完整SKU');
    setStatusMsg('请求发送中...');
    try {
      const res = await axios.post(`${apiUrl}/inventory/scan`,
        { materialSku: sku, quantity: Number(quantity) },
        { headers: { 'Authorization': `Bearer ${token}`, 'X-Company-Id': companyId } }
      );
      setStatusMsg(`✅ 扫码出库申请已生成`);
      setSku('');
    } catch (error: any) {
      setStatusMsg('');
      Alert.alert('扫描失败', error.response?.data?.message || error.message);
    }
  };

  const startCameraScan = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert('无权限', '需要相机权限才能使用扫码功能');
        return;
      }
    }
    setIsScanning(true);
  };

  const handleBarCodeScanned = (scanningResult: BarcodeScanningResult) => {
    const { data } = scanningResult;
    setSku(data);
    setIsScanning(false);
    // 可选：扫描后可自动提交出库，或者让用户手动检查再提交
  };

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <View style={styles.loginBox}>
          {showSettings ? (
            <View style={{ width: '100%' }}>
              <Text style={styles.title}>系统设置</Text>
              <TextInput
                style={styles.input}
                placeholder="API 服务器地址 (http://IP:PORT/api)"
                value={apiUrl}
                onChangeText={setApiUrl}
              />
              <TouchableOpacity style={styles.button} onPress={handleSaveSettings}>
                <Text style={styles.buttonText}>保存设置</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { backgroundColor: '#ccc' }]} onPress={() => setShowSettings(false)}>
                <Text style={styles.buttonText}>取消</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Box size={48} color="#3b82f6" style={{ alignSelf: 'center', marginBottom: 20 }} />
              <TouchableOpacity onPress={() => setShowSettings(true)} style={{ position: 'absolute', right: 0, top: 0, padding: 10 }}>
                <Settings size={24} color="#666" />
              </TouchableOpacity>
              <Text style={styles.title}>EIP 扫码终端</Text>
              <Text style={styles.subtitle}>仓库作业专用移动设备</Text>
              
              <TextInput
                style={styles.input}
                placeholder="员工账号"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
            placeholder="管理密码"
            value={password}
            secureTextEntry
            onChangeText={setPassword}
          />
          <TouchableOpacity style={styles.buttonMain} onPress={handleLogin}>
            <Text style={styles.buttonText}>接驳系统</Text>
          </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>仓库出库扫码</Text>
        <TouchableOpacity onPress={handleLogout}>
          <LogOut size={24} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {isScanning ? (
        <View style={styles.scannerContainer}>
          <CameraView 
            style={styles.camera} 
            facing="back"
            onBarcodeScanned={handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ["qr", "ean13", "ean8", "code128", "code39", "upc_a", "upc_e"],
            }}
          >
            <View style={styles.scannerOverlay}>
              <View style={styles.scanTarget} />
              <TouchableOpacity 
                style={styles.closeScanBtn}
                onPress={() => setIsScanning(false)}
              >
                <X color="#fff" size={24} />
                <Text style={{color: '#fff', marginLeft: 8}}>取消扫描</Text>
              </TouchableOpacity>
            </View>
          </CameraView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scanArea}>
          <TouchableOpacity 
            style={styles.cameraPlaceholder}
            onPress={startCameraScan}
          >
            <Camera size={64} color="#3b82f6" />
            <Text style={[styles.cameraText, {color: '#3b82f6'}]}>点击开启手机摄像头扫码</Text>
            <Text style={styles.cameraSubText}>(也可以直接使用红外物理扫码枪)</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.inputLg}
            placeholder="在此输入或等待扫描结果..."
            value={sku}
            onChangeText={setSku}
          />
          
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>扣减数量:</Text>
            <TextInput
              style={styles.qtyInput}
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
            />
          </View>

          <TouchableOpacity style={styles.buttonScan} onPress={handleScanSimulation}>
            <Scan size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>提交流转工单</Text>
          </TouchableOpacity>

          {statusMsg ? (
            <View style={styles.successMsg}>
              <CheckCircle2 color="#16a34a" size={20} />
              <Text style={styles.successText}>{statusMsg}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loginBox: { flex: 1, justifyContent: 'center', padding: 32 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: '#1e293b' },
  subtitle: { fontSize: 14, textAlign: 'center', color: '#64748b', marginBottom: 32 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginBottom: 16, fontSize: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  button: { backgroundColor: '#3b82f6', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 16 },
  buttonMain: { backgroundColor: '#3b82f6', borderRadius: 8, padding: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 20, paddingTop: 60, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  
  scanArea: { padding: 20 },
  cameraPlaceholder: { height: 200, backgroundColor: '#e2e8f0', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  cameraText: { marginTop: 12, fontSize: 16, fontWeight: 'bold', color: '#475569' },
  cameraSubText: { marginTop: 4, fontSize: 12, color: '#94a3b8' },
  
  inputLg: { backgroundColor: '#fff', borderRadius: 8, padding: 16, fontSize: 18, borderWidth: 2, borderColor: '#3b82f6', marginBottom: 16 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  qtyLabel: { fontSize: 16, color: '#334155', marginRight: 12, fontWeight: 'bold' },
  qtyInput: { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#cbd5e1', width: 100, textAlign: 'center' },
  
  buttonScan: { backgroundColor: '#10b981', flexDirection: 'row', borderRadius: 8, padding: 16, alignItems: 'center', justifyContent: 'center' },
  
  successMsg: { marginTop: 24, padding: 16, backgroundColor: '#dcfce3', borderRadius: 8, flexDirection: 'row', alignItems: 'center' },
  successText: { color: '#16a34a', marginLeft: 8, fontWeight: 'bold', flexShrink: 1 },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  scannerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  scanTarget: { width: 250, height: 250, borderWidth: 2, borderColor: '#3b82f6', backgroundColor: 'transparent' },
  closeScanBtn: { position: 'absolute', bottom: 40, flexDirection: 'row', alignItems: 'center', backgroundColor: '#ef4444', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 }
});

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { WarrantyAttachment } from '@/types/warranty';
import { persistFile } from '@/utils/shared/attachmentStorage';

type Props = {
  warrantyId: string;
  attachments: WarrantyAttachment[];
};

export default function AttachmentList({ warrantyId, attachments }: Props) {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const borderColor = useThemeColor({}, 'border');
  const textMuted = useThemeColor({}, 'textMuted');

  const addAttachment = useWarrantiesStore((s) => s.addAttachment);
  const removeAttachment = useWarrantiesStore((s) => s.removeAttachment);

  const addFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled) return;
    const uri = await persistFile(result.assets[0].uri, warrantyId);
    addAttachment(warrantyId, { id: Date.now().toString(), uri, name: 'photo.jpg', kind: 'image' });
  };

  const addFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled) return;
    const uri = await persistFile(result.assets[0].uri, warrantyId);
    addAttachment(warrantyId, { id: Date.now().toString(), uri, name: 'photo.jpg', kind: 'image' });
  };

  const addDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const uri = await persistFile(result.assets[0].uri, warrantyId);
    addAttachment(warrantyId, { id: Date.now().toString(), uri, name: result.assets[0].name, kind: 'document' });
  };

  const confirmRemove = (attachmentId: string) => {
    Alert.alert(t('warranties.removeAttachment'), undefined, [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('warranties.removeAttachment'), style: 'destructive', onPress: () => removeAttachment(warrantyId, attachmentId) },
    ]);
  };

  return (
    <View>
      <View style={styles.row}>
        <Pressable style={[styles.actionButton, { borderColor: accentTints.accentSoft, backgroundColor: accentTints.accentSoft }]} onPress={addFromCamera}>
          <View style={[styles.actionIconCircle, { backgroundColor: tint }]}>
            <SymbolView name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }} size={16} tintColor="#FFFFFF" />
          </View>
          <Text style={[styles.actionText, { color: tint }]}>{t('warranties.addPhoto')}</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, { borderColor: accentTints.accentSoft, backgroundColor: accentTints.accentSoft }]} onPress={addFromLibrary}>
          <View style={[styles.actionIconCircle, { backgroundColor: tint }]}>
            <SymbolView name={{ ios: 'photo.fill', android: 'image', web: 'image' }} size={16} tintColor="#FFFFFF" />
          </View>
          <Text style={[styles.actionText, { color: tint }]}>{t('warranties.addFromLibrary')}</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, { borderColor: accentTints.accentSoft, backgroundColor: accentTints.accentSoft }]} onPress={addDocument}>
          <View style={[styles.actionIconCircle, { backgroundColor: tint }]}>
            <SymbolView name={{ ios: 'doc.fill', android: 'description', web: 'description' }} size={16} tintColor="#FFFFFF" />
          </View>
          <Text style={[styles.actionText, { color: tint }]}>{t('warranties.addDocument')}</Text>
        </Pressable>
      </View>

      {attachments.length === 0 ? (
        <Text style={{ color: textMuted, fontSize: 13, marginTop: 8 }}>{t('warranties.noAttachments')}</Text>
      ) : (
        <View style={styles.grid}>
          {attachments.map((a) => (
            <Pressable
              key={a.id}
              style={[styles.thumb, { borderColor: accentTints.accentSoft }]}
              onPress={() => a.kind === 'image' && router.push({ pathname: '/warranties/view-image', params: { uri: a.uri } })}
              onLongPress={() => confirmRemove(a.id)}>
              {a.kind === 'image' ? (
                <Image source={{ uri: a.uri }} style={styles.thumbImage} />
              ) : (
                <View style={[styles.docIconWrap, { backgroundColor: accentTints.accentSoft }]}>
                  <SymbolView name={{ ios: 'doc.fill', android: 'description', web: 'description' }} size={26} tintColor={tint} />
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  actionButton: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  actionIconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  thumb: {
    width: 70,
    height: 70,
    borderWidth: 1.5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  docIconWrap: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
});
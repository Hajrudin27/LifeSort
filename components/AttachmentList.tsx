import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { Attachment } from '@/types/attachment';
import { persistFile } from '@/utils/shared/attachmentStorage';
import { compressImage } from '@/utils/shared/imageCompression';

type Props = {
  attachments: Attachment[];
  onAdd: (attachment: Attachment) => void;
  onRemove: (attachmentId: string) => void;
};

export default function AttachmentList({ attachments, onAdd, onRemove }: Props) {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const borderColor = useThemeColor({}, 'border');
  const textMuted = useThemeColor({}, 'textMuted');

  const addFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const compressed = await compressImage(asset.uri, asset.width, asset.height);
    const id = Date.now().toString();
    const uri = await persistFile(compressed.uri, id);
    onAdd({ id, uri, name: 'photo.jpg', kind: 'image' });
  };

  const addFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const compressed = await compressImage(asset.uri, asset.width, asset.height);
    const id = Date.now().toString();
    const uri = await persistFile(compressed.uri, id);
    onAdd({ id, uri, name: 'photo.jpg', kind: 'image' });
  };

  const addDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const id = Date.now().toString();
    const uri = await persistFile(result.assets[0].uri, result.assets[0].name);
    onAdd({ id, uri, name: result.assets[0].name, kind: 'document' });
  };

  const confirmRemove = (attachmentId: string) => {
    Alert.alert(t('warranties.removeAttachment'), undefined, [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('warranties.removeAttachment'), style: 'destructive', onPress: () => onRemove(attachmentId) },
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
                 <Image source={{ uri: a.uri }} style={styles.thumbImage} cachePolicy="disk" transition={150} />
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
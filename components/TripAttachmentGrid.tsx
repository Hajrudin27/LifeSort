import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet } from "react-native";

import { Text, useThemeColor, View } from "@/components/Themed";
import { useSensitiveAction } from "@/components/useSensitiveAction";
import { useAttachmentUri } from "@/hooks/useAttachmentUri";
import { TripAttachment } from "@/types/trip";
import { persistFile } from "@/utils/shared/attachmentStorage";
import {
  deleteCachedAttachmentFile,
  isTemporaryDecryptedAttachmentUri,
} from "@/core/storage/documentCacheStorage";
import { resolveAttachmentUri } from "@/utils/shared/attachmentSync";
import {
  consumeAttachmentViewerSource,
  registerAttachmentViewerSource,
} from "@/utils/shared/attachmentViewerSource";

type Props = {
  attachments: TripAttachment[];
  onAdd: (attachment: TripAttachment) => void;
  onRemove: (attachmentId: string) => void;
};

type ThumbProps = {
  attachment: TripAttachment;
  borderColor: string;
  onOpen: (attachment: TripAttachment) => void;
  onRemove: () => void;
};

function TripAttachmentThumb({ attachment, borderColor, onOpen, onRemove }: ThumbProps) {
  const { t } = useTranslation();
  const uri = useAttachmentUri(attachment, { enabled: attachment.kind === "image" });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.a11y.openAttachment')}
      style={[styles.thumb, { borderColor }]}
      onPress={() => onOpen(attachment)}
      onLongPress={onRemove}
    >
      {attachment.kind === "image" && uri ? (
        <Image source={{ uri }} style={styles.thumbImage} cachePolicy="memory" />
      ) : (
        <SymbolView
          name={{
            ios: "doc.text",
            android: "description",
            web: "description",
          }}
          size={28}
        />
      )}
    </Pressable>
  );
}

export default function TripAttachmentGrid({
  attachments,
  onAdd,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const { run: runSensitive, prompt: reauthPrompt } = useSensitiveAction();
  const borderColor = useThemeColor({}, "border");

  const addImage = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled) return;

    const asset = result.assets[0];
    const uri = await persistFile(asset.uri, asset.fileName ?? "photo.jpg");
    onAdd({
      id: Date.now().toString(),
      uri,
      name: asset.fileName ?? "photo.jpg",
      kind: "image",
    });
  };

  const addDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const uri = await persistFile(asset.uri, asset.name);
    onAdd({
      id: Date.now().toString(),
      uri,
      name: asset.name,
      kind: "document",
    });
  };

  const openAttachment = async (attachment: TripAttachment) => {
    if (attachment.kind === "image") {
      // At se billedet inde i appen sender ingenting ud af den.
      const sourceId = registerAttachmentViewerSource({
        id: attachment.id,
        uri: attachment.uri,
        name: attachment.name,
        kind: "image",
      });
      try {
        router.push({
          pathname: "/warranties/view-image",
          params: { sourceId },
        });
      } catch {
        consumeAttachmentViewerSource(sourceId);
      }
      return;
    }

    // Deling sender dokumentet ud af appen — derfor et bevis først (APP-024).
    await runSensitive(async () => {
      const available = await Sharing.isAvailableAsync();
      if (!available) return;

      let uri: string | null = null;
      try {
        uri = await resolveAttachmentUri(attachment);
        if (uri) await Sharing.shareAsync(uri);
      } finally {
        if (uri && isTemporaryDecryptedAttachmentUri(uri)) {
          await deleteCachedAttachmentFile(uri);
        }
      }
    });
  };

  const confirmRemove = (attachmentId: string) => {
    Alert.alert(t("warranties.removeAttachment"), undefined, [
      { text: t("warranties.cancel"), style: "cancel" },
      {
        text: t("warranties.removeAttachment"),
        style: "destructive",
        onPress: () => onRemove(attachmentId),
      },
    ]);
  };

  return (
    <View>
      {attachments.length === 0 && (
        <Text style={styles.empty}>{t("warranties.noAttachments")}</Text>
      )}

      <View style={styles.grid}>
        {attachments.map((a) => (
          <TripAttachmentThumb
            key={a.id}
            attachment={a}
            borderColor={borderColor}
            onOpen={openAttachment}
            onRemove={() => confirmRemove(a.id)}
          />
        ))}
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          accessibilityRole="button"
          style={[styles.actionButton, { borderColor }]}
          onPress={() => addImage(true)}
        >
          <Text style={styles.actionText}>{t("warranties.addPhoto")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.actionButton, { borderColor }]}
          onPress={() => addImage(false)}
        >
          <Text style={styles.actionText}>
            {t("warranties.addFromLibrary")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.actionButton, { borderColor }]}
          onPress={addDocument}
        >
          <Text style={styles.actionText}>{t("warranties.addDocument")}</Text>
        </Pressable>
      </View>
      {reauthPrompt}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { opacity: 0.5, fontSize: 13, marginVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  thumb: {
    width: 64,
    height: 64,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionButton: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  actionText: { fontSize: 13 },
});

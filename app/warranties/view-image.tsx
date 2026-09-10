import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { View } from "@/components/Themed";
import { useAttachmentUri } from "@/hooks/useAttachmentUri";
import { consumeAttachmentViewerSource } from "@/utils/shared/attachmentViewerSource";

export default function ViewImageScreen() {
  const { sourceId } = useLocalSearchParams<{ sourceId?: string }>();
  const [source] = useState(() => consumeAttachmentViewerSource(sourceId));
  const uri = useAttachmentUri(source, { enabled: Boolean(source) });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ presentation: "fullScreenModal", title: "" }} />
      {uri ? <Image source={{ uri }} style={styles.image} contentFit="contain" cachePolicy="memory" transition={150} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
});

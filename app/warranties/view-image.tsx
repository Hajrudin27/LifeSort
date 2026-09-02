import { Stack, useLocalSearchParams } from "expo-router";
import { Image, StyleSheet } from "react-native";

import { View } from "@/components/Themed";

export default function ViewImageScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ presentation: "fullScreenModal", title: "" }} />
      <Image source={{ uri }} style={styles.image} resizeMode="contain" />
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

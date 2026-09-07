import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useFoodStore } from "@/store/useFoodStore";
import { useToastStore } from "@/store/useToastStore";
import { daysUntil } from "@/utils/shared/dateDays";

export default function PantryScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");

  const pantryItems = useFoodStore((s) => s.pantryItems);
  const addPantryItem = useFoodStore((s) => s.addPantryItem);
  const removePantryItem = useFoodStore((s) => s.removePantryItem);
  const showToast = useToastStore((s) => s.show);

  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);

  const canAdd = name.trim().length > 0;

  const addItem = () => {
    addPantryItem({
      name: name.trim(),
      quantity: quantity.trim() || undefined,
      expiryDate: showExpiryPicker && expiryDate ? expiryDate : undefined,
    });
    showToast(t("common.saved"));
    setName("");
    setQuantity("");
    setExpiryDate("");
    setShowExpiryPicker(false);
  };

  const confirmRemove = (id: string) => {
    Alert.alert(t("food.delete"), undefined, [
      { text: t("warranties.cancel"), style: "cancel" },
      { text: t("food.delete"), style: "destructive", onPress: () => removePantryItem(id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={pantryItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t("food.pantryEmpty")}</Text>
          </Card>
        }
        renderItem={({ item }) => {
          const days = item.expiryDate ? daysUntil(item.expiryDate) : null;
          const isWarning = days !== null && days <= 3;
          return (
            <Pressable accessibilityRole="button" onLongPress={() => confirmRemove(item.id)}>
              <Card style={sharedStyles.rowBetween}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{item.name}</Text>
                  {item.quantity && <Text style={[styles.meta, { color: textMuted }]}>{item.quantity}</Text>}
                </View>
                {days !== null && (
                  <Text style={[styles.days, { color: isWarning ? danger : textMuted }]}>
                    {days < 0 ? t("food.expired") : t("food.expiresIn", { days })}
                  </Text>
                )}
              </Card>
            </Pressable>
          );
        }}
      />

      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.pantryNamePlaceholder")}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.pantryQuantityPlaceholder")}
          placeholderTextColor={borderColor}
          value={quantity}
          onChangeText={setQuantity}
        />

        {showExpiryPicker ? (
          <>
            <Text style={sharedStyles.fieldLabel}>{t("food.pantryExpiryLabel")}</Text>
            <DatePickerField value={expiryDate || new Date().toISOString().split("T")[0]} onChange={setExpiryDate} />
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowExpiryPicker(true)}>
            <Text style={[styles.addExpiryLink, { color: textMuted }]}>+ {t("food.pantryExpiryLabel")}</Text>
          </Pressable>
        )}

        <Button label={t("food.add")} disabled={!canAdd} onPress={addItem} />
      </Card>
    </View>
  );
}

const styles = {
  container: { flex: 1, padding: 16, gap: 12 },
  rowText: { flex: 1 },
  name: { fontWeight: "700" as const },
  meta: { fontSize: 13 },
  days: { fontSize: 13 },
  addExpiryLink: { fontSize: 13 },
};
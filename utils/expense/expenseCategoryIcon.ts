export function getCategoryIconName(category: string): {
  ios: string;
  android: string;
  web: string;
} {
  const key = category.toLowerCase();

  if (key === "subscription") {
    return {
      ios: "arrow.triangle.2.circlepath",
      android: "autorenew",
      web: "autorenew",
    };
  }
  if (key === "bill") {
    return {
      ios: "doc.text.fill",
      android: "receipt_long",
      web: "receipt_long",
    };
  }
  if (key === "other") {
    return {
      ios: "ellipsis.circle.fill",
      android: "more_horiz",
      web: "more_horiz",
    };
  }

  return { ios: "folder.fill", android: "folder", web: "folder" };
}

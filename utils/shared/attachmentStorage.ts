import * as FileSystem from "expo-file-system/legacy";

const ATTACHMENTS_DIR = `${FileSystem.documentDirectory}attachments/`;

async function ensureDirExists() {
  const dirInfo = await FileSystem.getInfoAsync(ATTACHMENTS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(ATTACHMENTS_DIR, {
      intermediates: true,
    });
  }
}

export async function persistFile(
  sourceUri: string,
  suggestedName: string,
): Promise<string> {
  await ensureDirExists();
  const extension = suggestedName.includes(".")
    ? suggestedName.split(".").pop()
    : "jpg";
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;
  const destination = `${ATTACHMENTS_DIR}${filename}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

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

/**
 * Fjerner alle lokalt gemte vedhæftninger (APP-021).
 *
 * Filerne blev tidligere liggende efter log ud: kvitteringer og garantibilleder
 * fra den forrige bruger stod stadig i appens mappe, selvom hendes konto var
 * væk fra skærmen. Det var fund D4 i docs/data-sdk-inventory.md.
 *
 * Filer, der er nået op i skyen, hentes ned igen ved behov; filer, der ikke er,
 * hører til den konto, der lige er logget ud af.
 */
export async function clearAttachmentCache(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(ATTACHMENTS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(ATTACHMENTS_DIR, { idempotent: true });
    }
  } catch {
    // Log ud må aldrig fejle, fordi en fil ikke kunne slettes. Næste forsøg
    // rydder resten.
  }
}

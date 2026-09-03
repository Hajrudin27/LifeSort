import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Skalerer og komprimerer et billede før det gemmes/uploades — reducerer typisk et
 * kamera-billede på 3-5 MB til et par hundrede KB uden mærkbart kvalitetstab ved
 * normal visningsstørrelse (kvitteringer, garantibeviser).
 */
export async function compressImage(
  uri: string,
  originalWidth: number,
  originalHeight: number,
  options: { maxDimension?: number; quality?: number } = {},
): Promise<{ uri: string; width: number; height: number }> {
  const { maxDimension = 1600, quality = 0.75 } = options;

  // Kender vi ikke de oprindelige mål (nogle systemer leverer 0), springer vi
  // skalering over og komprimerer bare billedet som det er.
  if (!originalWidth || !originalHeight) {
    const rendered = await ImageManipulator.manipulate(uri).renderAsync();
    return rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  }

  const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
  const targetWidth = Math.round(originalWidth * scale);

  const rendered = await ImageManipulator.manipulate(uri).resize({ width: targetWidth }).renderAsync();
  return rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
}
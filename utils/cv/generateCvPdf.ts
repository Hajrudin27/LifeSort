import * as Print from 'expo-print';

export async function previewCvPdf(html: string) {
  try {
    await Print.printAsync({ html });
  } catch (error) {
    // Brugeren annullerede print-dialogen — det er en helt normal,
    // forventet handling, ikke en reel fejl, så vi ignorerer den stille.
    if (error instanceof Error && error.message.includes('PrintIncompleteException')) {
      return;
    }
    // Enhver anden, uventet fejl kastes videre, så den ikke skjules.
    throw error;
  }
}
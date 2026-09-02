import { StyleSheet } from 'react-native';

export const sharedStyles = StyleSheet.create({
  // Formular-container: bruges som top-level container i næsten alle "opret/rediger"-skærme
  formContainer: { flex: 1, padding: 16, gap: 16 },
  formContainerScroll: { padding: 16, gap: 16, paddingBottom: 48 },

  // Kort der indeholder et sæt formularfelter
  card: { gap: 14 },

  // Standard tekstfelt
  input: { borderWidth: 1, borderRadius: 12, padding: 14 },

  // Multiline tekstfelt (instruktioner, noter)
  inputMultiline: { minHeight: 100, textAlignVertical: 'top' },

  // Label over et felt (fx "Udløbsdato")
  fieldLabel: { fontWeight: '600' },

  // Chip-/kategori-rækker
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // Sektionsoverskrift midt i en skærm (fx "Hvor du skal købe hvad")
  sectionLabel: { opacity: 0.6, fontSize: 13, marginTop: 8, fontWeight: '600' },

  // Liste-container
  list: { gap: 10 },

  // Tom-liste-tekst
  emptyState: { textAlign: 'center', marginTop: 24 },

  // Standard "række"-kort: navn til venstre, værdi/meta til højre
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  emptyCard: {  alignItems: 'center', paddingVertical: 8},
});
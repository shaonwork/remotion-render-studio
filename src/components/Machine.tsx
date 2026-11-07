/* The old "This computer" page grew into the full Settings page (this
   computer + render + data in one place). This alias stays so the /pc
   route — and anything still importing MachinePage — keeps working. */
export { SettingsPage as MachinePage } from "./Settings";

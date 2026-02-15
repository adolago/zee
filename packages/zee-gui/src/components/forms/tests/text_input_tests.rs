#[cfg(test)]
mod tests {
    use super::super::TextInputState;

    #[test]
    fn test_text_input_state_initialization() {
        let state = TextInputState::new();
        assert!(state.value.is_empty());
        assert!(state.label.is_none());
        assert!(state.helper_text.is_none());
    }

    #[test]
    fn test_text_input_state_value_update() {
        let mut state = TextInputState::new();
        state.set_value("Hello");
        assert_eq!(state.value, "Hello");
    }

    #[test]
    fn test_text_input_state_focus_blur() {
        let mut state = TextInputState::new();
        assert!(!state.focused);
        assert!(!state.touched);

        state.focus();
        assert!(state.focused);

        state.blur();
        assert!(!state.focused);
        assert!(state.touched);
    }
}

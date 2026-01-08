package com.zee.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class ZeeProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", ZeeCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", ZeeCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", ZeeCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", ZeeCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", ZeeCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", ZeeCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", ZeeCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", ZeeCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", ZeeCapability.Canvas.rawValue)
    assertEquals("camera", ZeeCapability.Camera.rawValue)
    assertEquals("screen", ZeeCapability.Screen.rawValue)
    assertEquals("voiceWake", ZeeCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", ZeeScreenCommand.Record.rawValue)
  }
}

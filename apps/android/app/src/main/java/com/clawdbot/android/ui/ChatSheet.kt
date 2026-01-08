package com.zee.android.ui

import androidx.compose.runtime.Composable
import com.zee.android.MainViewModel
import com.zee.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}

package com.zee.android

import android.app.Application

class NodeApp : Application() {
  val runtime: NodeRuntime by lazy { NodeRuntime(this) }
}


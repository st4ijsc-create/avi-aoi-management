package com.foutec.FactoryAlertSystem

import android.annotation.SuppressLint
import android.app.Service
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.animation.ValueAnimator
import android.view.animation.OvershootInterpolator
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat

/**
 * Floating Bubble Service
 * Hiển thị bubble nổi trên màn hình khi có alert
 */
class FloatingBubbleService : Service() {

    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var expandedView: View? = null
    private var overlayAlertView: View? = null
    private var bulletinOverlayView: View? = null
    private var isExpanded = false
    
    // Alert data (for bubble)
    private var currentAlertId: String? = null
    private var currentTitle: String? = null
    private var currentMessage: String? = null
    private var currentSeverity: String? = null
    private var pendingCount: Int = 0
    private var isForeground = false

    // Overlay alert data (rich data)
    private var overlayAlertId: String? = null
    private var overlayAlertType: String? = null
    private var overlaySeverity: String? = null
    private var overlayStationName: String? = null
    private var overlayStationLine: String? = null
    private var overlayProductName: String? = null
    private var overlayProductSerial: String? = null
    private var overlayErrorCode: String? = null
    private var overlayErrorType: String? = null
    private var overlayErrorDesc: String? = null
    private var overlayMachineName: String? = null
    private var overlayTimestamp: String? = null
    private var overlayNgPointCount: Int = 0
    private var overlayTotalNG: Int = 0
    private var overlayInspectionId: Int = 0
    private var overlayDisplayDuration: Long = 15000

    // Bulletin data
    private var currentBulletinId: String? = null
    private var currentStationName: String? = null
    private var currentLineName: String? = null
    private var currentYieldRate: Float = 0f
    private var currentPeriodStart: String? = null
    private var currentPeriodEnd: String? = null
    private var currentTotalOutput: Int = 0
    private var currentNgCount: Int = 0
    private var currentTotalAlerts: Int = 0

    companion object {
        private var instance: FloatingBubbleService? = null
        
        fun isRunning(): Boolean = instance != null
        
        const val ACTION_SHOW_BUBBLE = "com.foutec.FactoryAlertSystem.SHOW_BUBBLE"
        const val ACTION_UPDATE_BUBBLE = "com.foutec.FactoryAlertSystem.UPDATE_BUBBLE"
        const val ACTION_HIDE_BUBBLE = "com.foutec.FactoryAlertSystem.HIDE_BUBBLE"
        const val ACTION_SHOW_ALERT = "com.foutec.FactoryAlertSystem.SHOW_ALERT"
        const val ACTION_SHOW_OVERLAY_ALERT = "com.foutec.FactoryAlertSystem.SHOW_OVERLAY_ALERT"
        const val ACTION_HIDE_OVERLAY_ALERT = "com.foutec.FactoryAlertSystem.HIDE_OVERLAY_ALERT"
        const val ACTION_SHOW_BULLETIN = "com.foutec.FactoryAlertSystem.SHOW_BULLETIN"
        const val ACTION_HIDE_BULLETIN = "com.foutec.FactoryAlertSystem.HIDE_BULLETIN"
        
        const val EXTRA_ALERT_ID = "alertId"
        const val EXTRA_TITLE = "title"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_SEVERITY = "severity"
        const val EXTRA_PENDING_COUNT = "pendingCount"
        
        // Overlay alert extras
        const val EXTRA_ALERT_TYPE = "alertType"
        const val EXTRA_STATION_LINE = "stationLine"
        const val EXTRA_PRODUCT_NAME = "productName"
        const val EXTRA_PRODUCT_SERIAL = "productSerial"
        const val EXTRA_ERROR_CODE = "errorCode"
        const val EXTRA_ERROR_TYPE = "errorType"
        const val EXTRA_ERROR_DESC = "errorDesc"
        const val EXTRA_MACHINE_NAME = "machineName"
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_NG_POINT_COUNT = "ngPointCount"
        const val EXTRA_TOTAL_NG = "totalNG"
        const val EXTRA_INSPECTION_ID = "inspectionId"
        const val EXTRA_DISPLAY_DURATION = "displayDuration"
        
        // Bulletin extras
        const val EXTRA_BULLETIN_ID = "bulletinId"
        const val EXTRA_STATION_NAME = "stationName"
        const val EXTRA_LINE_NAME = "lineName"
        const val EXTRA_YIELD_RATE = "yieldRate"
        const val EXTRA_PERIOD_START = "periodStart"
        const val EXTRA_PERIOD_END = "periodEnd"
        const val EXTRA_TOTAL_OUTPUT = "totalOutput"
        const val EXTRA_NG_COUNT = "ngCount"
        const val EXTRA_TOTAL_ALERTS = "totalAlerts"
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureForeground()

        when (intent?.action) {
            ACTION_SHOW_BUBBLE -> showBubble()
            ACTION_UPDATE_BUBBLE -> {
                pendingCount = intent.getIntExtra(EXTRA_PENDING_COUNT, 0)
                updateBubbleBadge()
            }
            ACTION_HIDE_BUBBLE -> hideBubble()
            ACTION_SHOW_ALERT -> {
                currentAlertId = intent.getStringExtra(EXTRA_ALERT_ID)
                currentTitle = intent.getStringExtra(EXTRA_TITLE)
                currentMessage = intent.getStringExtra(EXTRA_MESSAGE)
                currentSeverity = intent.getStringExtra(EXTRA_SEVERITY) ?: "high"
                pendingCount = intent.getIntExtra(EXTRA_PENDING_COUNT, 1)
                showBubble()
            }
            ACTION_SHOW_OVERLAY_ALERT -> {
                overlayAlertId = intent.getStringExtra(EXTRA_ALERT_ID)
                overlayAlertType = intent.getStringExtra(EXTRA_ALERT_TYPE)
                overlaySeverity = intent.getStringExtra(EXTRA_SEVERITY) ?: "high"
                overlayStationName = intent.getStringExtra(EXTRA_STATION_NAME) ?: "N/A"
                overlayStationLine = intent.getStringExtra(EXTRA_STATION_LINE) ?: ""
                overlayProductName = intent.getStringExtra(EXTRA_PRODUCT_NAME) ?: "N/A"
                overlayProductSerial = intent.getStringExtra(EXTRA_PRODUCT_SERIAL) ?: ""
                overlayErrorCode = intent.getStringExtra(EXTRA_ERROR_CODE) ?: ""
                overlayErrorType = intent.getStringExtra(EXTRA_ERROR_TYPE) ?: "Alert"
                overlayErrorDesc = intent.getStringExtra(EXTRA_ERROR_DESC) ?: ""
                overlayMachineName = intent.getStringExtra(EXTRA_MACHINE_NAME) ?: ""
                overlayTimestamp = intent.getStringExtra(EXTRA_TIMESTAMP) ?: ""
                overlayNgPointCount = intent.getIntExtra(EXTRA_NG_POINT_COUNT, 0)
                overlayTotalNG = intent.getIntExtra(EXTRA_TOTAL_NG, 0)
                overlayInspectionId = intent.getIntExtra(EXTRA_INSPECTION_ID, 0)
                overlayDisplayDuration = intent.getLongExtra(EXTRA_DISPLAY_DURATION, 15000)
                showOverlayAlertDialog()
            }
            ACTION_HIDE_OVERLAY_ALERT -> {
                hideOverlayAlertDialog()
            }
            ACTION_SHOW_BULLETIN -> {
                currentBulletinId = intent.getStringExtra(EXTRA_BULLETIN_ID)
                currentStationName = intent.getStringExtra(EXTRA_STATION_NAME) ?: "N/A"
                currentLineName = intent.getStringExtra(EXTRA_LINE_NAME) ?: ""
                currentYieldRate = intent.getFloatExtra(EXTRA_YIELD_RATE, 0f)
                currentPeriodStart = intent.getStringExtra(EXTRA_PERIOD_START) ?: ""
                currentPeriodEnd = intent.getStringExtra(EXTRA_PERIOD_END) ?: ""
                currentTotalOutput = intent.getIntExtra(EXTRA_TOTAL_OUTPUT, 0)
                currentNgCount = intent.getIntExtra(EXTRA_NG_COUNT, 0)
                currentTotalAlerts = intent.getIntExtra(EXTRA_TOTAL_ALERTS, 0)
                showBulletinOverlay()
            }
            ACTION_HIDE_BULLETIN -> {
                hideBulletinOverlay()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        if (isForeground) {
            try {
                stopForeground(true)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            isForeground = false
        }
        hideBubble()
    }

    private fun ensureForeground() {
        if (isForeground) return

        val channelId = "factory_alert_bubble"
        val channelName = "Factory Alert Bubble"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (notificationManager.getNotificationChannel(channelId) == null) {
                val channel = NotificationChannel(
                    channelId,
                    channelName,
                    NotificationManager.IMPORTANCE_LOW
                )
                channel.description = "Hiển thị dịch vụ bubble cảnh báo đang chạy"
                notificationManager.createNotificationChannel(channel)
            }
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Factory Alert System")
            .setContentText("Bubble cảnh báo đang hiển thị")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

        try {
            startForeground(1001, notification)
            isForeground = true
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showBubble() {
        if (floatingView != null) return
        if (!canDrawOverlays()) return

        // Create bubble view programmatically
        floatingView = createBubbleView()

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 200
        }

        try {
            windowManager?.addView(floatingView, params)
            animateBubbleIn()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createBubbleView(): View {
        val context = this
        
        // Main container
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }

        // Bubble circle
        val bubbleSize = dpToPx(56)
        val bubbleBackground = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xFFDC2626.toInt()) // Red color
        }
        val bubble = LinearLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(bubbleSize, bubbleSize)
            gravity = Gravity.CENTER
            background = bubbleBackground
            elevation = 8f
        }

        // Factory icon (using text as placeholder)
        val icon = TextView(context).apply {
            text = "🏭"
            textSize = 24f
            gravity = Gravity.CENTER
        }
        bubble.addView(icon)

        // Badge for pending count
        val badgeBackground = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xFFEF4444.toInt())
        }
        val badge = TextView(context).apply {
            tag = "badge"
            text = pendingCount.toString()
            textSize = 10f
            setTextColor(0xFFFFFFFF.toInt())
            gravity = Gravity.CENTER
            setPadding(dpToPx(4), dpToPx(2), dpToPx(4), dpToPx(2))
            background = badgeBackground
            visibility = if (pendingCount > 0) View.VISIBLE else View.GONE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(dpToPx(30), dpToPx(-20), 0, 0)
            }
        }

        container.addView(bubble)
        container.addView(badge)

        // Touch handling for drag and click
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isClick = true

        container.setOnTouchListener { view, event ->
            val params = floatingView?.layoutParams as? WindowManager.LayoutParams ?: return@setOnTouchListener false
            
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isClick = true
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = (event.rawX - initialTouchX).toInt()
                    val deltaY = (event.rawY - initialTouchY).toInt()
                    
                    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                        isClick = false
                    }
                    
                    params.x = initialX + deltaX
                    params.y = initialY + deltaY
                    windowManager?.updateViewLayout(floatingView, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (isClick) {
                        onBubbleClick()
                    } else {
                        snapToEdge(params)
                    }
                    true
                }
                else -> false
            }
        }

        return container
    }

    private fun updateBubbleBadge() {
        floatingView?.findViewWithTag<TextView>("badge")?.apply {
            text = pendingCount.toString()
            visibility = if (pendingCount > 0) View.VISIBLE else View.GONE
        }
    }

    private fun showExpandedAlert() {
        if (expandedView != null) {
            hideExpandedAlert()
        }
        if (!canDrawOverlays()) return

        expandedView = createExpandedView()

        val params = WindowManager.LayoutParams(
            dpToPx(300),
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 100
        }

        try {
            windowManager?.addView(expandedView, params)
            animateExpandedIn()
            
            // Auto hide after 10 seconds
            expandedView?.postDelayed({
                hideExpandedAlert()
            }, 10000)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createExpandedView(): View {
        val context = this
        
        // Card container
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(12))
            setBackgroundColor(0xFFFFFFFF.toInt())
            elevation = 16f
        }

        // Severity color bar
        val severityColor = when (currentSeverity) {
            "critical" -> 0xFFDC2626.toInt()
            "high" -> 0xFFEA580C.toInt()
            "medium" -> 0xFFCA8A04.toInt()
            "low" -> 0xFF2563EB.toInt()
            else -> 0xFF6B7280.toInt()
        }

        val colorBar = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(4)
            ).apply {
                bottomMargin = dpToPx(8)
            }
            setBackgroundColor(severityColor)
        }
        card.addView(colorBar)

        // Header row
        val headerRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val alertIcon = TextView(context).apply {
            text = "🚨"
            textSize = 20f
        }
        headerRow.addView(alertIcon)

        val severityText = TextView(context).apply {
            text = currentSeverity?.uppercase() ?: "ALERT"
            textSize = 14f
            setTextColor(severityColor)
            setPadding(dpToPx(8), 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerRow.addView(severityText)

        val closeBtn = TextView(context).apply {
            text = "✕"
            textSize = 18f
            setTextColor(0xFF6B7280.toInt())
            setPadding(dpToPx(8), dpToPx(4), dpToPx(4), dpToPx(4))
            setOnClickListener { hideExpandedAlert() }
        }
        headerRow.addView(closeBtn)
        
        card.addView(headerRow)

        // Title
        val title = TextView(context).apply {
            text = currentTitle ?: "Alert"
            textSize = 16f
            setTextColor(0xFF1F2937.toInt())
            setPadding(0, dpToPx(8), 0, dpToPx(4))
        }
        card.addView(title)

        // Message
        val message = TextView(context).apply {
            text = currentMessage ?: ""
            textSize = 13f
            setTextColor(0xFF6B7280.toInt())
            maxLines = 3
        }
        card.addView(message)

        // Action buttons
        val buttonRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dpToPx(12), 0, 0)
        }

        val dismissBtn = TextView(context).apply {
            text = "Bỏ qua"
            textSize = 14f
            setTextColor(0xFF6B7280.toInt())
            setPadding(dpToPx(12), dpToPx(8), dpToPx(12), dpToPx(8))
            setOnClickListener { 
                hideExpandedAlert()
                sendBroadcast(Intent("com.foutec.FactoryAlertSystem.ALERT_DISMISSED").apply {
                    putExtra("alertId", currentAlertId)
                })
            }
        }
        buttonRow.addView(dismissBtn)

        val ackBtn = TextView(context).apply {
            text = "Xác nhận"
            textSize = 14f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(severityColor)
            setPadding(dpToPx(16), dpToPx(8), dpToPx(16), dpToPx(8))
            setOnClickListener {
                hideExpandedAlert()
                openApp()
                sendBroadcast(Intent("com.foutec.FactoryAlertSystem.ALERT_ACKNOWLEDGED").apply {
                    putExtra("alertId", currentAlertId)
                })
            }
        }
        buttonRow.addView(ackBtn)

        card.addView(buttonRow)

        // Touch to dismiss
        card.setOnTouchListener { _, _ -> true }

        return card
    }

    private fun hideExpandedAlert() {
        expandedView?.let {
            try {
                windowManager?.removeView(it)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            expandedView = null
        }
    }

    private fun hideBubble() {
        hideExpandedAlert()
        hideOverlayAlertDialog()
        hideBulletinOverlay()
        floatingView?.let {
            try {
                windowManager?.removeView(it)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            floatingView = null
        }
    }

    private fun onBubbleClick() {
        if (isExpanded) {
            hideExpandedAlert()
            isExpanded = false
        } else {
            openApp()
        }
    }

    private fun openApp() {
        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        startActivity(intent)
    }

    private fun snapToEdge(params: WindowManager.LayoutParams) {
        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val middle = screenWidth / 2

        val animator = ValueAnimator.ofInt(params.x, if (params.x < middle) 0 else screenWidth - dpToPx(56))
        animator.duration = 200
        animator.interpolator = OvershootInterpolator()
        animator.addUpdateListener { animation ->
            params.x = animation.animatedValue as Int
            try {
                windowManager?.updateViewLayout(floatingView, params)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        animator.start()
    }

    private fun animateBubbleIn() {
        floatingView?.apply {
            scaleX = 0f
            scaleY = 0f
            alpha = 0f
            animate()
                .scaleX(1f)
                .scaleY(1f)
                .alpha(1f)
                .setDuration(300)
                .setInterpolator(OvershootInterpolator())
                .start()
        }
    }

    private fun animateExpandedIn() {
        expandedView?.apply {
            translationY = -100f
            alpha = 0f
            animate()
                .translationY(0f)
                .alpha(1f)
                .setDuration(300)
                .setInterpolator(OvershootInterpolator())
                .start()
        }
    }

    private fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    // ==================== OVERLAY ALERT DIALOG ====================

    private fun showOverlayAlertDialog() {
        if (overlayAlertView != null) {
            hideOverlayAlertDialog()
        }
        if (!canDrawOverlays()) return

        overlayAlertView = createOverlayAlertView()

        val params = WindowManager.LayoutParams(
            dpToPx(340),
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dpToPx(60)
        }

        try {
            windowManager?.addView(overlayAlertView, params)
            // Animate in
            overlayAlertView?.apply {
                translationY = -200f
                alpha = 0f
                animate()
                    .translationY(0f)
                    .alpha(1f)
                    .setDuration(400)
                    .setInterpolator(OvershootInterpolator(0.8f))
                    .start()
            }

            // Auto hide after configured duration
            overlayAlertView?.postDelayed({
                hideOverlayAlertDialog()
            }, overlayDisplayDuration)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createOverlayAlertView(): View {
        val context = this

        // Severity colors
        val severityGradient = when (overlaySeverity) {
            "critical" -> intArrayOf(0xFFDC2626.toInt(), 0xFFB91C1C.toInt())
            "high" -> intArrayOf(0xFFEA580C.toInt(), 0xFFC2410C.toInt())
            "medium" -> intArrayOf(0xFFF59E0B.toInt(), 0xFFD97706.toInt())
            "low" -> intArrayOf(0xFF2563EB.toInt(), 0xFF1D4ED8.toInt())
            else -> intArrayOf(0xFF6366F1.toInt(), 0xFF4F46E5.toInt())
        }
        val severityIcon = when (overlaySeverity) {
            "critical" -> "🔴"
            "high" -> "🟠"
            "medium" -> "🟡"
            "low" -> "🔵"
            else -> "⚪"
        }
        val severityLabel = when (overlaySeverity) {
            "critical" -> "NGHIÊM TRỌNG"
            "high" -> "CAO"
            "medium" -> "TRUNG BÌNH"
            "low" -> "THẤP"
            else -> "THÔNG TIN"
        }

        // Main card
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFFFFFFF.toInt())
            elevation = 24f
            setPadding(0, 0, 0, dpToPx(12))
        }

        // Gradient header
        val header = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(14), dpToPx(16), dpToPx(14))
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                severityGradient
            )
        }

        // Header top row
        val headerTopRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val headerIconTv = TextView(context).apply {
            text = severityIcon
            textSize = 18f
        }
        headerTopRow.addView(headerIconTv)

        val headerTitle = TextView(context).apply {
            text = "CẢNH BÁO $severityLabel"
            textSize = 15f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(dpToPx(8), 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerTopRow.addView(headerTitle)

        val closeBtn = TextView(context).apply {
            text = "✕"
            textSize = 18f
            setTextColor(0xCCFFFFFF.toInt())
            setPadding(dpToPx(8), dpToPx(4), dpToPx(4), dpToPx(4))
            setOnClickListener { hideOverlayAlertDialog() }
        }
        headerTopRow.addView(closeBtn)
        header.addView(headerTopRow)

        // Error type subtitle in header
        if (!overlayErrorType.isNullOrEmpty()) {
            val subtitleRow = TextView(context).apply {
                text = "${overlayErrorType}${if (!overlayErrorCode.isNullOrEmpty()) " ($overlayErrorCode)" else ""}"
                textSize = 12f
                setTextColor(0xB3FFFFFF.toInt())
                setPadding(dpToPx(26), dpToPx(4), 0, 0)
            }
            header.addView(subtitleRow)
        }

        card.addView(header)

        // Content area
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(4))
        }

        // Error description
        if (!overlayErrorDesc.isNullOrEmpty()) {
            val errorDescTv = TextView(context).apply {
                text = overlayErrorDesc
                textSize = 14f
                setTextColor(0xFF1F2937.toInt())
                maxLines = 3
                setPadding(0, 0, 0, dpToPx(10))
            }
            content.addView(errorDescTv)
        }

        // Info rows
        addInfoRow(content, "📍", "Trạm", "${overlayStationName}${if (!overlayStationLine.isNullOrEmpty()) " • $overlayStationLine" else ""}")
        addInfoRow(content, "📦", "Sản phẩm", "${overlayProductName}${if (!overlayProductSerial.isNullOrEmpty()) " (S/N: $overlayProductSerial)" else ""}")
        if (!overlayMachineName.isNullOrEmpty()) {
            addInfoRow(content, "🏭", "Máy", overlayMachineName!!)
        }
        if (!overlayTimestamp.isNullOrEmpty()) {
            addInfoRow(content, "🕐", "Thời gian", overlayTimestamp!!)
        }

        // NG stats row
        if (overlayTotalNG > 0 || overlayNgPointCount > 0) {
            val ngRow = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dpToPx(8), 0, dpToPx(4))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            }

            if (overlayTotalNG > 0) {
                val ngBadge = TextView(context).apply {
                    text = "NG: $overlayTotalNG"
                    textSize = 12f
                    setTextColor(0xFFFFFFFF.toInt())
                    setPadding(dpToPx(10), dpToPx(4), dpToPx(10), dpToPx(4))
                    background = GradientDrawable().apply {
                        cornerRadius = dpToPx(12).toFloat()
                        setColor(0xFFDC2626.toInt())
                    }
                }
                ngRow.addView(ngBadge)
            }

            if (overlayNgPointCount > 0) {
                val pointBadge = TextView(context).apply {
                    text = "Điểm lỗi: $overlayNgPointCount"
                    textSize = 12f
                    setTextColor(0xFFFFFFFF.toInt())
                    setPadding(dpToPx(10), dpToPx(4), dpToPx(10), dpToPx(4))
                    val lp = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { marginStart = dpToPx(8) }
                    layoutParams = lp
                    background = GradientDrawable().apply {
                        cornerRadius = dpToPx(12).toFloat()
                        setColor(0xFFEA580C.toInt())
                    }
                }
                ngRow.addView(pointBadge)
            }

            content.addView(ngRow)
        }

        card.addView(content)

        // Divider
        val divider = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(1)
            ).apply { topMargin = dpToPx(8) }
            setBackgroundColor(0xFFE5E7EB.toInt())
        }
        card.addView(divider)

        // Action buttons
        val buttonRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dpToPx(16), dpToPx(12), dpToPx(16), 0)
        }

        val dismissBtn = TextView(context).apply {
            text = "Bỏ qua"
            textSize = 13f
            setTextColor(0xFF6B7280.toInt())
            setPadding(dpToPx(16), dpToPx(8), dpToPx(16), dpToPx(8))
            setOnClickListener {
                hideOverlayAlertDialog()
                sendBroadcast(Intent("com.foutec.FactoryAlertSystem.ALERT_DISMISSED").apply {
                    putExtra("alertId", overlayAlertId)
                })
            }
        }
        buttonRow.addView(dismissBtn)

        val spacer = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        buttonRow.addView(spacer)

        val ackBtn = TextView(context).apply {
            text = "📋 Xem chi tiết"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(dpToPx(16), dpToPx(8), dpToPx(16), dpToPx(8))
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                severityGradient
            ).apply {
                cornerRadius = dpToPx(6).toFloat()
            }
            setOnClickListener {
                hideOverlayAlertDialog()
                openApp()
                sendBroadcast(Intent("com.foutec.FactoryAlertSystem.ALERT_ACKNOWLEDGED").apply {
                    putExtra("alertId", overlayAlertId)
                })
            }
        }
        buttonRow.addView(ackBtn)

        card.addView(buttonRow)

        card.setOnTouchListener { _, _ -> true }

        return card
    }

    private fun addInfoRow(parent: LinearLayout, icon: String, label: String, value: String) {
        val context = this
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dpToPx(3), 0, dpToPx(3))
        }

        val iconTv = TextView(context).apply {
            text = icon
            textSize = 13f
            setPadding(0, 0, dpToPx(6), 0)
        }
        row.addView(iconTv)

        val labelTv = TextView(context).apply {
            text = "$label: "
            textSize = 12f
            setTextColor(0xFF9CA3AF.toInt())
        }
        row.addView(labelTv)

        val valueTv = TextView(context).apply {
            text = value
            textSize = 12f
            setTextColor(0xFF374151.toInt())
            maxLines = 2
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(valueTv)

        parent.addView(row)
    }

    private fun hideOverlayAlertDialog() {
        overlayAlertView?.let {
            try {
                windowManager?.removeView(it)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            overlayAlertView = null
        }
    }

    // ==================== BULLETIN OVERLAY ====================

    private fun showBulletinOverlay() {
        if (bulletinOverlayView != null) {
            hideBulletinOverlay()
        }
        if (!canDrawOverlays()) return

        bulletinOverlayView = createBulletinOverlayView()

        val params = WindowManager.LayoutParams(
            dpToPx(340),
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dpToPx(60)
        }

        try {
            windowManager?.addView(bulletinOverlayView, params)
            animateBulletinIn()

            // Auto hide after 30 seconds
            bulletinOverlayView?.postDelayed({
                hideBulletinOverlay()
            }, 30000)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createBulletinOverlayView(): View {
        val context = this
        val density = resources.displayMetrics.density
        
        // Main card
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFFFFFFF.toInt())
            elevation = 24f
            setPadding(0, 0, 0, dpToPx(16))
        }

        // Gradient header
        val header = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(14), dpToPx(16), dpToPx(14))
            val gradientDrawable = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xFF0EA5E9.toInt(), 0xFF0284C7.toInt())
            )
            background = gradientDrawable
        }

        // Header top row: icon + title + close button
        val headerTopRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val headerIcon = TextView(context).apply {
            text = "📊"
            textSize = 18f
        }
        headerTopRow.addView(headerIcon)

        val headerTitle = TextView(context).apply {
            text = "BẢN TIN ĐỊNH KỲ"
            textSize = 15f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(dpToPx(8), 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerTopRow.addView(headerTitle)

        val closeBtnHeader = TextView(context).apply {
            text = "✕"
            textSize = 18f
            setTextColor(0xCCFFFFFF.toInt())
            setPadding(dpToPx(8), dpToPx(4), dpToPx(4), dpToPx(4))
            setOnClickListener { hideBulletinOverlay() }
        }
        headerTopRow.addView(closeBtnHeader)
        header.addView(headerTopRow)

        // Station name row
        val stationRow = TextView(context).apply {
            text = "${currentStationName ?: "N/A"}${if (!currentLineName.isNullOrEmpty()) " • $currentLineName" else ""}"
            textSize = 12f
            setTextColor(0xB3FFFFFF.toInt())
            setPadding(dpToPx(26), dpToPx(4), 0, 0)
        }
        header.addView(stationRow)

        card.addView(header)

        // Content area
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(4))
        }

        // Period text
        val periodText = TextView(context).apply {
            val start = currentPeriodStart ?: ""
            val end = currentPeriodEnd ?: ""
            text = "⏱ $start → $end"
            textSize = 11f
            setTextColor(0xFF6B7280.toInt())
            setPadding(0, 0, 0, dpToPx(10))
        }
        content.addView(periodText)

        // Yield + Stats row
        val statsRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        // Yield gauge (simplified)
        val yieldColor = when {
            currentYieldRate >= 95f -> 0xFF22C55E.toInt()
            currentYieldRate >= 85f -> 0xFFF59E0B.toInt()
            else -> 0xFFDC2626.toInt()
        }

        val yieldContainer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dpToPx(4), 0, dpToPx(12), 0)
        }

        val yieldCircle = LinearLayout(context).apply {
            val circleSize = dpToPx(60)
            layoutParams = LinearLayout.LayoutParams(circleSize, circleSize)
            gravity = Gravity.CENTER
            val circleDrawable = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setStroke(dpToPx(3), yieldColor)
                setColor(yieldColor and 0x1AFFFFFF or 0x0D000000)
            }
            background = circleDrawable
        }

        val yieldValueText = TextView(context).apply {
            text = String.format("%.1f%%", currentYieldRate)
            textSize = 14f
            setTextColor(yieldColor)
            gravity = Gravity.CENTER
        }
        yieldCircle.addView(yieldValueText)
        yieldContainer.addView(yieldCircle)

        val yieldLabel = TextView(context).apply {
            text = "Yield"
            textSize = 10f
            setTextColor(0xFF6B7280.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dpToPx(4), 0, 0)
        }
        yieldContainer.addView(yieldLabel)
        statsRow.addView(yieldContainer)

        // Stats grid (right side)
        val statsGrid = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        // Row 1: Total output + NG count
        val statsRow1 = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        statsRow1.addView(createStatItem(context, "Sản lượng", currentTotalOutput.toString(), 0xFF2563EB.toInt()))
        statsRow1.addView(createStatItem(context, "Lỗi NG", currentNgCount.toString(), 0xFFDC2626.toInt()))
        statsGrid.addView(statsRow1)

        // Row 2: Total alerts
        val statsRow2 = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dpToPx(6), 0, 0)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        statsRow2.addView(createStatItem(context, "Cảnh báo", currentTotalAlerts.toString(), 0xFFF59E0B.toInt()))
        statsGrid.addView(statsRow2)

        statsRow.addView(statsGrid)
        content.addView(statsRow)
        card.addView(content)

        // Divider
        val divider = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(1)
            ).apply {
                topMargin = dpToPx(8)
            }
            setBackgroundColor(0xFFE5E7EB.toInt())
        }
        card.addView(divider)

        // Action buttons row
        val buttonRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dpToPx(16), dpToPx(12), dpToPx(16), 0)
        }

        val dismissBtn = TextView(context).apply {
            text = "Bỏ qua"
            textSize = 13f
            setTextColor(0xFF6B7280.toInt())
            setPadding(dpToPx(16), dpToPx(8), dpToPx(16), dpToPx(8))
            setOnClickListener {
                hideBulletinOverlay()
                sendBroadcast(Intent("com.foutec.FactoryAlertSystem.BULLETIN_DISMISSED").apply {
                    putExtra("bulletinId", currentBulletinId)
                })
            }
        }
        buttonRow.addView(dismissBtn)

        // Spacer
        val spacer = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        buttonRow.addView(spacer)

        val viewDetailBtn = TextView(context).apply {
            text = "📋 Xem chi tiết"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(dpToPx(16), dpToPx(8), dpToPx(16), dpToPx(8))
            val btnBg = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xFF0EA5E9.toInt(), 0xFF0284C7.toInt())
            ).apply {
                cornerRadius = dpToPx(6).toFloat()
            }
            background = btnBg
            setOnClickListener {
                hideBulletinOverlay()
                openApp()
                sendBroadcast(Intent("com.foutec.FactoryAlertSystem.BULLETIN_VIEW_DETAIL").apply {
                    putExtra("bulletinId", currentBulletinId)
                })
            }
        }
        buttonRow.addView(viewDetailBtn)

        card.addView(buttonRow)

        // Touch to prevent touch-through
        card.setOnTouchListener { _, _ -> true }

        return card
    }

    private fun createStatItem(context: Context, label: String, value: String, color: Int): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dpToPx(8), dpToPx(4), dpToPx(8), dpToPx(4))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)

            val valueView = TextView(context).apply {
                text = value
                textSize = 16f
                setTextColor(color)
                gravity = Gravity.CENTER
            }
            addView(valueView)

            val labelView = TextView(context).apply {
                text = label
                textSize = 10f
                setTextColor(0xFF9CA3AF.toInt())
                gravity = Gravity.CENTER
            }
            addView(labelView)
        }
    }

    private fun hideBulletinOverlay() {
        bulletinOverlayView?.let {
            try {
                windowManager?.removeView(it)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            bulletinOverlayView = null
        }
    }

    private fun animateBulletinIn() {
        bulletinOverlayView?.apply {
            translationY = -200f
            alpha = 0f
            animate()
                .translationY(0f)
                .alpha(1f)
                .setDuration(400)
                .setInterpolator(OvershootInterpolator(0.8f))
                .start()
        }
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }
}

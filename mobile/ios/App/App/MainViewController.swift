import UIKit
import Capacitor

/// The app's web view: swipe from the edge to go back, like any iOS app.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}

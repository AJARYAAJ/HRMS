package main

import (
	"errors"
	"os"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

// AppKit must be driven from the process's main thread, so the main goroutine is pinned to it.
func init() { runtime.LockOSThread() }

var (
	appKitOnce sync.Once
	appKitErr  error
	selCache   = map[string]objc.SEL{}
	selMu      sync.Mutex
	trayMain   *macTray // used by the Objective-C callbacks
)

func sel(name string) objc.SEL {
	selMu.Lock()
	defer selMu.Unlock()
	s, ok := selCache[name]
	if !ok {
		s = objc.RegisterName(name)
		selCache[name] = s
	}
	return s
}

func cls(name string) objc.ID { return objc.ID(objc.GetClass(name)) }

func nsString(s string) objc.ID { return cls("NSString").Send(sel("stringWithUTF8String:"), s) }

func loadAppKit() error {
	appKitOnce.Do(func() {
		if _, err := purego.Dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", purego.RTLD_NOW|purego.RTLD_GLOBAL); err != nil {
			appKitErr = err
			return
		}
		// Handler class: menu item actions and the refresh timer call back into Go.
		_, appKitErr = objc.RegisterClass("PHAgentTrayHandler", objc.GetClass("NSObject"), nil, nil, []objc.MethodDef{
			{Cmd: sel("menuAction:"), Fn: func(self objc.ID, _ objc.SEL, sender objc.ID) {
				if t := trayMain; t != nil {
					handleMenu(t.backend, objc.Send[int](sender, sel("tag")), openURL)
					t.refresh(true)
				}
			}},
			{Cmd: sel("tick:"), Fn: func(self objc.ID, _ objc.SEL, timer objc.ID) {
				if t := trayMain; t != nil {
					t.tick()
				}
			}},
		})
	})
	return appKitErr
}

type macTray struct {
	backend  trayBackend
	item     objc.ID
	handler  objc.ID
	images   map[string]objc.ID
	lastKey  string
	lastMenu string
	done     <-chan struct{}
	exit     func()
}

func openURL(u string) {
	pool := cls("NSAutoreleasePool").Send(sel("alloc")).Send(sel("init"))
	defer pool.Send(sel("drain"))
	url := cls("NSURL").Send(sel("URLWithString:"), nsString(u))
	if url != 0 {
		cls("NSWorkspace").Send(sel("sharedWorkspace")).Send(sel("openURL:"), url)
	}
}

func (t *macTray) image(key string) objc.ID {
	if img, ok := t.images[key]; ok {
		return img
	}
	data, err := pngWithDPI(trayIcon(36, key), 144) // 36 px at 144 dpi = 18 pt, crisp on Retina
	if err != nil {
		return 0
	}
	nsdata := cls("NSData").Send(sel("dataWithBytes:length:"), unsafe.Pointer(&data[0]), len(data))
	runtime.KeepAlive(data)
	img := cls("NSImage").Send(sel("alloc")).Send(sel("initWithData:"), nsdata)
	t.images[key] = img
	return img
}

// newMacTray creates the status-bar item. Call on the main thread with an autorelease pool in place.
func newMacTray(b trayBackend) (*macTray, error) {
	if err := loadAppKit(); err != nil {
		return nil, err
	}
	app := cls("NSApplication").Send(sel("sharedApplication"))
	if app == 0 {
		return nil, errors.New("NSApplication unavailable (no window server session?)")
	}
	app.Send(sel("setActivationPolicy:"), 1) // accessory: menu bar icon only, no Dock icon
	bar := cls("NSStatusBar").Send(sel("systemStatusBar"))
	item := bar.Send(sel("statusItemWithLength:"), float64(-1)) // NSVariableStatusItemLength
	if item == 0 {
		return nil, errors.New("could not create a status bar item")
	}
	item.Send(sel("retain"))
	t := &macTray{backend: b, item: item, images: map[string]objc.ID{}}
	t.handler = cls("PHAgentTrayHandler").Send(sel("alloc")).Send(sel("init"))
	trayMain = t
	t.refresh(true)
	return t, nil
}

func (t *macTray) buildMenu(s TrayState) objc.ID {
	menu := cls("NSMenu").Send(sel("alloc")).Send(sel("init"))
	menu.Send(sel("setAutoenablesItems:"), false)
	for _, e := range trayMenu(s, time.Now()) {
		var mi objc.ID
		if e.Separator {
			mi = cls("NSMenuItem").Send(sel("separatorItem"))
		} else {
			mi = cls("NSMenuItem").Send(sel("alloc")).Send(sel("initWithTitle:action:keyEquivalent:"), nsString(e.Label), sel("menuAction:"), nsString(""))
			mi.Send(sel("setTag:"), e.ID)
			mi.Send(sel("setTarget:"), t.handler)
			mi.Send(sel("setEnabled:"), e.ID != 0)
			mi.Send(sel("autorelease"))
		}
		menu.Send(sel("addItem:"), mi)
	}
	return menu
}

func menuSignature(entries []menuEntry) string {
	var b []byte
	for _, e := range entries {
		b = append(b, e.Label...)
		b = append(b, '|')
	}
	return string(b)
}

// refresh updates the icon, tooltip and menu when they change. The timer doesn't fire while the menu is
// open (it runs in the default run-loop mode), so the menu is never replaced under the user's cursor.
func (t *macTray) refresh(force bool) {
	s := t.backend.TrayState()
	button := t.item.Send(sel("button"))
	if key := iconKey(s); force || key != t.lastKey {
		if img := t.image(key); img != 0 {
			button.Send(sel("setImage:"), img)
		}
		t.lastKey = key
	}
	button.Send(sel("setToolTip:"), nsString(trayTooltip(s, time.Now())))
	entries := trayMenu(s, time.Now())
	if sig := menuSignature(entries); force || sig != t.lastMenu {
		menu := t.buildMenu(s)
		t.item.Send(sel("setMenu:"), menu)
		menu.Send(sel("release"))
		t.lastMenu = sig
	}
}

func (t *macTray) tick() {
	select {
	case <-t.done:
		t.remove()
		t.exit()
	default:
		t.refresh(false)
	}
}

func (t *macTray) remove() {
	cls("NSStatusBar").Send(sel("systemStatusBar")).Send(sel("removeStatusItem:"), t.item)
	trayMain = nil
}

// runUI runs the agent on a goroutine and AppKit's event loop on the main thread. When the agent stops,
// the next timer tick removes the icon and exits the process (AppKit's loop can't simply be returned from).
// Without a window server (e.g. over SSH) the agent runs without an icon.
func runUI(a *Agent, run func() error) error {
	result := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		err := run()
		result <- err
		close(done)
	}()
	pool := cls("NSAutoreleasePool").Send(sel("alloc")).Send(sel("init"))
	t, err := newMacTray(a)
	if err != nil {
		pool.Send(sel("drain"))
		a.logger.Printf("menu bar icon unavailable: %v", err)
		return <-result
	}
	t.done = done
	t.exit = func() {
		code := 0
		if err := <-result; err != nil {
			code = 1
		}
		os.Exit(code)
	}
	cls("NSTimer").Send(sel("scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:"), float64(1), t.handler, sel("tick:"), objc.ID(0), true)
	pool.Send(sel("drain"))
	a.logger.Printf("menu bar icon shown")
	cls("NSApplication").Send(sel("sharedApplication")).Send(sel("run"))
	return <-result
}

package main

// The keychain is reached through the Security framework directly, not the
// /usr/bin/security CLI a keyring library would shell out to: kaja ships
// sandboxed through the App Store, where spawning a system binary to reach the
// keychain doesn't work and wouldn't file items under the app anyway.
//
// Queries opt in to the data protection keychain (TN3137), the one Apple points
// new code at. It scopes items to the app's own access group - derived from the
// com.apple.application-identifier entitlement the store build is signed with -
// so a sandboxed app reads back exactly what it wrote, with no ACL prompts. The
// cost is that an unsigned local build has no such entitlement and gets
// errSecMissingEntitlement, which Available() reports as "no store" so the UI
// asks for the environment instead.

/*
// kSecUseDataProtectionKeychain arrived in macOS 10.15, later than the 10.13
// deployment target Go's cgo defaults to, so this file states its own. Nothing
// is lost: the Go toolchain this builds with already requires a newer macOS
// than either number.
#cgo CFLAGS: -mmacosx-version-min=10.15
#cgo LDFLAGS: -framework CoreFoundation -framework Security

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdlib.h>
#include <string.h>

// keychainQuery builds the generic-password query identifying one item.
static CFMutableDictionaryRef keychainQuery(const char* service, const char* account) {
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    CFStringRef serviceRef = CFStringCreateWithCString(NULL, service, kCFStringEncodingUTF8);
    CFStringRef accountRef = CFStringCreateWithCString(NULL, account, kCFStringEncodingUTF8);

    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, serviceRef);
    CFDictionarySetValue(query, kSecAttrAccount, accountRef);
    CFDictionarySetValue(query, kSecUseDataProtectionKeychain, kCFBooleanTrue);

    CFRelease(serviceRef);
    CFRelease(accountRef);
    return query;
}

// kajaKeychainGet reads an item's value, returning NULL when there is none.
// *status carries the OSStatus, so the caller can tell "no such item" from
// "this build can't reach the keychain at all".
static char* kajaKeychainGet(const char* service, const char* account, int* status) {
    CFMutableDictionaryRef query = keychainQuery(service, account);
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

    CFTypeRef result = NULL;
    OSStatus err = SecItemCopyMatching(query, &result);
    CFRelease(query);

    *status = (int)err;
    if (err != errSecSuccess || result == NULL) {
        return NULL;
    }

    CFDataRef data = (CFDataRef)result;
    CFIndex length = CFDataGetLength(data);
    char* value = malloc(length + 1);
    memcpy(value, CFDataGetBytePtr(data), length);
    value[length] = '\0';
    CFRelease(data);
    return value;
}

// kajaKeychainSet writes an item's value, adding it or replacing what is there.
static int kajaKeychainSet(const char* service, const char* account, const char* value) {
    CFMutableDictionaryRef query = keychainQuery(service, account);
    CFDataRef data = CFDataCreate(NULL, (const UInt8*)value, (CFIndex)strlen(value));

    OSStatus err = SecItemCopyMatching(query, NULL);
    if (err == errSecSuccess) {
        CFMutableDictionaryRef update = CFDictionaryCreateMutable(NULL, 0,
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        CFDictionarySetValue(update, kSecValueData, data);
        err = SecItemUpdate(query, update);
        CFRelease(update);
    } else {
        CFDictionarySetValue(query, kSecValueData, data);
        // The value is only ever needed while someone is using the app, and it
        // has no business travelling to another Mac in a backup.
        CFDictionarySetValue(query, kSecAttrAccessible, kSecAttrAccessibleWhenUnlockedThisDeviceOnly);
        err = SecItemAdd(query, NULL);
    }

    CFRelease(data);
    CFRelease(query);
    return (int)err;
}

static int kajaKeychainDelete(const char* service, const char* account) {
    CFMutableDictionaryRef query = keychainQuery(service, account);
    OSStatus err = SecItemDelete(query);
    CFRelease(query);
    return (int)err;
}
*/
import "C"

import (
	"fmt"
	"log/slog"
	"unsafe"
)

const (
	errSecSuccess      = 0
	errSecItemNotFound = -25300
)

func keychainGet(account string) (string, bool) {
	cService := C.CString(keychainService)
	defer C.free(unsafe.Pointer(cService))
	cAccount := C.CString(account)
	defer C.free(unsafe.Pointer(cAccount))

	var status C.int
	value := C.kajaKeychainGet(cService, cAccount, &status)
	if value == nil {
		if int(status) != errSecItemNotFound {
			slog.Warn("Failed to read a stored variable value", "status", int(status))
		}
		return "", false
	}
	defer C.free(unsafe.Pointer(value))
	return C.GoString(value), true
}

func keychainSet(account string, value string) error {
	cService := C.CString(keychainService)
	defer C.free(unsafe.Pointer(cService))
	cAccount := C.CString(account)
	defer C.free(unsafe.Pointer(cAccount))
	cValue := C.CString(value)
	defer C.free(unsafe.Pointer(cValue))

	if status := int(C.kajaKeychainSet(cService, cAccount, cValue)); status != errSecSuccess {
		return fmt.Errorf("keychain write failed (OSStatus %d)", status)
	}
	return nil
}

func keychainDelete(account string) error {
	cService := C.CString(keychainService)
	defer C.free(unsafe.Pointer(cService))
	cAccount := C.CString(account)
	defer C.free(unsafe.Pointer(cAccount))

	status := int(C.kajaKeychainDelete(cService, cAccount))
	if status != errSecSuccess && status != errSecItemNotFound {
		return fmt.Errorf("keychain delete failed (OSStatus %d)", status)
	}
	return nil
}

// probeKeychain asks for an item that isn't there. Being told so is the
// successful outcome: the keychain answered. Anything else - most likely a build
// without the entitlement the data protection keychain needs - means there is
// nothing to store values in.
func probeKeychain(account string) bool {
	cService := C.CString(keychainService)
	defer C.free(unsafe.Pointer(cService))
	cAccount := C.CString(account)
	defer C.free(unsafe.Pointer(cAccount))

	var status C.int
	if value := C.kajaKeychainGet(cService, cAccount, &status); value != nil {
		C.free(unsafe.Pointer(value))
	}

	available := int(status) == errSecSuccess || int(status) == errSecItemNotFound
	if !available {
		slog.Warn("No usable keychain; ${secret} variables will only resolve from the environment", "status", int(status))
	}
	return available
}

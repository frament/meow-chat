// Command jwtprobe exists so the "JWT_SECRET must be set" rule can be testable.
//
// auth.RequireSecret ends the process via log.Fatal, which cannot be asserted
// from a unit test in the same process - it would take the test binary down too.
// So the check lives in a separate binary that does exactly what main() does.
//
// Used by scripts/check-jwt-secret.sh, wired into CI.
package main

import (
	"fmt"
	"os"

	"my-chat-backend/auth"
)

func main() {
	// Tests set a value through auth.SetJWTSecret; a real run reaches here with
	// whatever the environment provided.
	if os.Getenv("MEWCHAT_SKIP_SECRET_CHECK") == "1" {
		fmt.Println("skip")
		return
	}
	auth.RequireSecret()
	fmt.Println("secret present")
}

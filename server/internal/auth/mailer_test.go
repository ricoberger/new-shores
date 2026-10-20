package auth

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"strings"
	"testing"
)

// fakeSMTP accepts one connection and rejects the recipient with a reply
// that names it (as real servers do).
func fakeSMTP(t *testing.T, rcptReply string) string {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		defer func() { _ = c.Close() }()
		r := bufio.NewReader(c)
		write := func(s string) { _, _ = c.Write([]byte(s + "\r\n")) }
		write("220 fake ESMTP")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			cmd := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				write("250 fake")
			case strings.HasPrefix(cmd, "MAIL FROM"):
				write("250 ok")
			case strings.HasPrefix(cmd, "RCPT TO"):
				write(rcptReply)
			case strings.HasPrefix(cmd, "QUIT"):
				write("221 bye")
				return
			default:
				write("250 ok")
			}
		}
	}()
	return l.Addr().String()
}

// TestSMTPFailureDoesNotLeakTheRecipient: a rejection naming the recipient
// becomes a category-only error and log line.
func TestSMTPFailureDoesNotLeakTheRecipient(t *testing.T) {
	const victim = "victim@example.org"
	addr := fakeSMTP(t, "550 5.1.1 <"+victim+">: Recipient address rejected")
	m, err := NewSMTPMailer("smtp://"+addr, "noreply@example.org")
	if err != nil {
		t.Fatal(err)
	}
	sendErr := m.Send(context.Background(), victim, "Confirm", "body")
	var me *MailError
	if !errors.As(sendErr, &me) || me.Category != "smtp reply 550" || strings.Contains(sendErr.Error(), victim) {
		t.Fatalf("error %v", sendErr)
	}
	var logs bytes.Buffer
	s := &Service{cfg: Config{Mailer: m, Logger: slog.New(slog.NewTextHandler(&logs, nil))}}
	addr2 := fakeSMTP(t, "550 5.1.1 <"+victim+">: Recipient address rejected")
	s.cfg.Mailer, _ = NewSMTPMailer("smtp://"+addr2, "noreply@example.org")
	s.send(context.Background(), victim, "Confirm", "body")
	if strings.Contains(logs.String(), victim) || !strings.Contains(logs.String(), "smtp reply 550") {
		t.Fatalf("log: %s", logs.String())
	}
}

func TestSMTPConnectionFailureCategory(t *testing.T) {
	l, _ := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	addr := l.Addr().String()
	_ = l.Close() // nothing listens any more
	m, _ := NewSMTPMailer("smtp://"+addr, "noreply@example.org")
	err := m.Send(context.Background(), "victim@example.org", "s", "b")
	if MailFailure(err) != "smtp connection failed" || strings.Contains(err.Error(), "victim") {
		t.Fatalf("%v", err)
	}
	if MailFailure(errors.New("x <victim@example.org>")) != "mail delivery failed" {
		t.Fatal("unknown errors must not be logged verbatim")
	}
	if err := m.Send(context.Background(), "a@b.org\r\nBcc: c@d.org", "s", "b"); MailFailure(err) != "invalid mail header" {
		t.Fatalf("%v", err)
	}
}

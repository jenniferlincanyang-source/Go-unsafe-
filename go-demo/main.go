package main

import (
	"encoding/binary"
	"fmt"
	"unsafe"
)

// 重要说明：
// - Go 语言本身对数组/切片访问有边界检查，正常代码不会出现传统 C 那种“栈缓冲区溢出”。
// - 这里用 unsafe 演示“越界写会破坏相邻内存”的现象（覆盖一个哨兵值），用于理解原理。
// - 该示例不展示也不指导如何覆盖返回地址、构造利用载荷、绕过防护等可直接用于攻击的内容。

type frame struct {
	buf    [16]byte
	canary uint64 // 仅用于演示：期望它不被修改
}

func main() {
	var f frame
	f.canary = 0x1122334455667788

	fmt.Printf("Before: canary = 0x%016x\n", f.canary)
	fmt.Printf("Layout: &buf=%p, &canary=%p (distance=%d bytes)\n",
		&f.buf[0], &f.canary, uintptr(unsafe.Pointer(&f.canary))-uintptr(unsafe.Pointer(&f.buf[0])),
	)

	// 构造一个“看起来像 payload”的数据：16 字节填充 + 8 字节新 canary 值。
	// 在 C 的典型栈溢出里，这种“越过局部缓冲区边界继续写”的行为就是破坏的起点。
	payload := make([]byte, 16+8)
	for i := 0; i < 16; i++ {
		payload[i] = 'A'
	}
	binary.LittleEndian.PutUint64(payload[16:], 0xdeadbeefcafebabe)

	// 关键：故意越界写
	// 我们把 payload 从 buf 起始地址开始逐字节写入，会覆盖 buf 后面的字段（这里就是 canary）。
	base := (*byte)(unsafe.Pointer(&f.buf[0]))
	for i := 0; i < len(payload); i++ {
		*(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(base)) + uintptr(i))) = payload[i]
	}

	fmt.Printf("After : canary = 0x%016x\n", f.canary)
	if f.canary != 0x1122334455667788 {
		fmt.Println("Result: adjacent memory was corrupted (demo).")
	} else {
		fmt.Println("Result: canary unchanged (unexpected for this demo).")
	}
}


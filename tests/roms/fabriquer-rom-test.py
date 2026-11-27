# Fabrique tests/roms/test-rouge.gba : une toute petite ROM GBA écrite pour les tests (aucun jeu Nintendo).
# Elle remplit l'écran de rouge (mode bitmap 3) puis écrit 0x42 dans la sauvegarde SRAM.
#   pip install keystone-engine && python3 fabriquer-rom-test.py
from keystone import Ks, KS_ARCH_ARM, KS_MODE_ARM

BASE = 0x08000000
ks = Ks(KS_ARCH_ARM, KS_MODE_ARM)
saut, _ = ks.asm("b 0x080000C0", BASE)
programme, _ = ks.asm("""
    mov r0, #0x04000000
    mov r1, #0x400
    orr r1, r1, #3          @ DISPCNT = mode 3 + fond 2
    strh r1, [r0]
    mov r0, #0x06000000
    mov r1, #0x1F
    orr r1, r1, #0x1F0000   @ deux pixels rouges (BGR555)
    mov r2, #0x4B00         @ 240 x 160 / 2 mots
boucle:
    str r1, [r0], #4
    subs r2, r2, #1
    bne boucle
    mov r0, #0x0E000000
    mov r1, #0x42
    strb r1, [r0]           @ un octet dans la SRAM
fin:
    b fin
""", BASE + 0xC0)
rom = bytearray(0x10000)
rom[0:4] = bytes(saut)
rom[0xA0:0xAC] = b"TEST ROUGE\0\0"
rom[0xAC:0xB0] = b"TEST"
rom[0xB0:0xB2] = b"00"
rom[0xB2] = 0x96
rom[0xBD] = (-(sum(rom[0xA0:0xBD]) + 0x19)) & 0xFF
rom[0xC0:0xC0 + len(programme)] = bytes(programme)
rom[0x200:0x209] = b"SRAM_V113"   # indique à l'émulateur une sauvegarde de type SRAM
open("test-rouge.gba", "wb").write(rom)
print("test-rouge.gba :", len(rom), "octets,", len(programme) // 4, "instructions")

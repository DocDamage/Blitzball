"""Disassemble the US executable (SLUS_203.12) with capstone: r5900dis.py <table vaddr hex> <index hex>...  (prints handler code of a pointer table entry)."""
import sys,struct
from capstone import *
b=open(r'F:\dev\FFX Project\data\raw\disc\SLUS_203.12','rb').read()
md=Cs(CS_ARCH_MIPS,CS_MODE_MIPS64+CS_MODE_LITTLE_ENDIAN)
def dis(v,n=24):
    o=v-0x100000+0x1000
    for i in md.disasm(b[o:o+n*4],v):
        print('  %x: %s %s'%(i.address,i.mnemonic,i.op_str))
def tab(base,i): return struct.unpack_from('<I',b,base-0x100000+0x1000+4*i)[0]
if __name__=='__main__':
    base=int(sys.argv[1],16)
    for i in map(lambda x:int(x,16),sys.argv[2:]):
        v=tab(base,i); print('idx %x -> %x'%(i,v)); dis(v,14)

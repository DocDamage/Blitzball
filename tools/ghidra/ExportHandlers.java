// Ghidra headless post-script: create functions at a list of addresses (file of hex addresses, one per line)
// and decompile just those into one text file. Used for jump-table targets Ghidra does not find on its own.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.app.cmd.disassemble.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class ExportHandlers extends GhidraScript {
    @Override
    public void run() throws Exception {
        String addrFile = getScriptArgs()[0];
        String outFile = getScriptArgs()[1];
        List<String> lines = Files.readAllLines(Paths.get(addrFile));
        Set<Long> seen = new TreeSet<>();
        for (String l : lines) { l = l.trim(); if (!l.isEmpty()) seen.add(Long.parseLong(l, 16)); }
        for (long a : seen) {
            Address ad = toAddr(a);
            if (getFunctionAt(ad) == null) {
                disassemble(ad);
                createFunction(ad, null);
            }
        }
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(new FileWriter(outFile))) {
            for (long a : seen) {
                Function fn = getFunctionAt(toAddr(a));
                w.println("// ==== " + String.format("%x", a));
                if (fn == null) { w.println("// no function"); continue; }
                DecompileResults r = ifc.decompileFunction(fn, 60, monitor);
                w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        }
        ifc.dispose();
    }
}

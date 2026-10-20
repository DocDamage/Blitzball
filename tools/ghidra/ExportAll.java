// Ghidra headless post-script: export decompiled C for every function and a symbol list.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class ExportAll extends GhidraScript {
    @Override
    public void run() throws Exception {
        String outDir = getScriptArgs().length > 0 ? getScriptArgs()[0] : "ghidra_out";
        new File(outDir).mkdirs();
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        try (PrintWriter all = new PrintWriter(new FileWriter(new File(outDir, "all_functions.c")))) {
            while (it.hasNext()) {
                Function fn = it.next();
                DecompileResults res = ifc.decompileFunction(fn, 60, monitor);
                all.println("// ==== " + fn.getName() + " @ " + fn.getEntryPoint());
                if (res != null && res.decompileCompleted()) {
                    all.println(res.getDecompiledFunction().getC());
                } else {
                    all.println("// decompile failed");
                }
            }
        }
        ifc.dispose();
    }
}
